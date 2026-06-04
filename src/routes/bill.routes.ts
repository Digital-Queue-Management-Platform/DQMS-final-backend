import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { fetchBillFromSltApi, fetchMultipleBillsFromSltApi, normalizeSltBillData } from '../services/sltBillingService';
import * as sltBillingService from '../services/sltBillingService';
import smsHelper from '../utils/smsHelper';

const router = Router();
const prisma = new PrismaClient();

// ─── Daily Bill-Enquiry Rate Limit ────────────────────────────────────────────
// To protect customer privacy, each mobile number may only request their
// bill amount via SMS a maximum of BILL_SMS_DAILY_LIMIT times per calendar day.
const BILL_SMS_DAILY_LIMIT = 3;
const BILL_SMS_ACTION_KEY = 'bill_sms_enquiry';

/**
 * Returns the current count for a mobile number today (in Asia/Colombo time).
 * Returns { allowed: true, count } when under the limit, or
 *         { allowed: false, count, limit } when the limit is reached/exceeded.
 *
 * When `increment` is true the counter is atomically incremented BEFORE checking
 * so the check and increment are a single atomic operation (upsert).
 */
async function checkAndIncrementBillSmsRateLimit(
  mobileNumber: string,
  increment = true
): Promise<{ allowed: boolean; count: number; limit: number; remaining: number }> {
  // Check if rate limiting is globally enabled in AppSettings
  const setting = await prisma.appSetting.findUnique({
    where: { key: 'bill_enquiry_rate_limit_enabled' }
  });
  const isRateLimitEnabled = setting?.booleanValue ?? true;

  if (!isRateLimitEnabled) {
    return { allowed: true, count: 0, limit: BILL_SMS_DAILY_LIMIT, remaining: BILL_SMS_DAILY_LIMIT };
  }

  // Calendar date in Sri Lanka (Asia/Colombo, UTC+5:30)
  const now = new Date();
  const slOffset = 5.5 * 60 * 60 * 1000; // 5 h 30 min in ms
  const slNow = new Date(now.getTime() + slOffset);
  const dateKey = slNow.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const trackerId = `${BILL_SMS_ACTION_KEY}:${mobileNumber}:${dateKey}`;

  if (increment) {
    // Atomically increment – if record doesn't exist, create with count = 1
    const tracker = await prisma.dailyActionTracker.upsert({
      where: { mobileNumber_date: { mobileNumber, date: dateKey } },
      update: { count: { increment: 1 }, updatedAt: now },
      create: {
        id: trackerId,
        mobileNumber,
        date: dateKey,
        count: 1,
        updatedAt: now,
      },
      select: { count: true },
    });

    const count = tracker.count;
    const allowed = count <= BILL_SMS_DAILY_LIMIT;
    return { allowed, count, limit: BILL_SMS_DAILY_LIMIT, remaining: Math.max(0, BILL_SMS_DAILY_LIMIT - count) };
  } else {
    // Read-only check (no increment)
    const tracker = await prisma.dailyActionTracker.findUnique({
      where: { mobileNumber_date: { mobileNumber, date: dateKey } },
      select: { count: true },
    });
    const count = tracker?.count ?? 0;
    const allowed = count < BILL_SMS_DAILY_LIMIT;
    return { allowed, count, limit: BILL_SMS_DAILY_LIMIT, remaining: Math.max(0, BILL_SMS_DAILY_LIMIT - count) };
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/bills/verify-multiple - Verify multiple SLT telephone numbers and get bill details
router.post('/verify-multiple', async (req: Request, res: Response) => {
  try {
    const { telephoneNumbers, mobileNumber } = req.body;

    // Validate input
    if (!Array.isArray(telephoneNumbers) || telephoneNumbers.length === 0) {
      return res.status(400).json({
        error: 'telephoneNumbers must be a non-empty array.'
      });
    }

    if (telephoneNumbers.length > 10) { // Limit to 10 numbers to prevent abuse
      return res.status(400).json({
        error: 'Maximum 10 telephone numbers allowed per request.'
      });
    }

    // Validate each telephone number format
    const phoneRegex = /^\d{10}$/;
    const invalidNumbers = telephoneNumbers.filter(num => !phoneRegex.test(num));
    
    if (invalidNumbers.length > 0) {
      return res.status(400).json({
        error: `Invalid telephone numbers. Must be 10 digits: ${invalidNumbers.join(', ')}`
      });
    }

    // Validate mobileNumber if provided
    if (mobileNumber) {
      const mobileRegex = /^\d{9,12}$/;
      if (!mobileRegex.test(mobileNumber)) {
        return res.status(400).json({
          error: 'Invalid mobileNumber. Must be strictly 9 to 12 digits (numeric only).'
        });
      }

      // ── Rate limit: max BILL_SMS_DAILY_LIMIT bill SMS enquiries per mobile per day ──
      // Increment the counter first; if the resulting count exceeds the limit, reject.
      const rateCheck = await checkAndIncrementBillSmsRateLimit(mobileNumber, true);
      if (!rateCheck.allowed) {
        console.warn(`[BILL][RATE-LIMIT] Mobile ${mobileNumber} exceeded daily bill SMS limit (${rateCheck.count}/${rateCheck.limit})`);
        return res.status(429).json({
          error: `Daily bill enquiry limit reached. For privacy protection, each mobile number can only request bill details ${BILL_SMS_DAILY_LIMIT} times per day. Please try again tomorrow.`,
          rateLimited: true,
          limit: rateCheck.limit,
          count: rateCheck.count,
          remaining: rateCheck.remaining,
        });
      }
      console.log(`[BILL][RATE-LIMIT] Mobile ${mobileNumber}: ${rateCheck.count}/${rateCheck.limit} enquiries today`);
    }

    const forceRefresh = req.query.force === 'true';
    const results: any[] = [];
    const smsNotifications: any[] = [];
    const errors: any[] = [];

    // Check cache first if not forcing refresh AND no mobile number provided
    // (Providing a mobile number implies a request for a new SMS notification)
    if (!forceRefresh && !mobileNumber) {
      for (const telephoneNumber of telephoneNumbers) {
        try {
          const cachedBill = await prisma.sltBill.findUnique({
            where: { telephoneNumber },
            select: {
              id: true,
              telephoneNumber: true,
              mobileNumber: true,
              accountName: true,
              accountAddress: true,
              currentBill: true,
              dueDate: true,
              status: true,
              lastPaymentDate: true,
              updatedAt: true,
            }
          });

          // Use cache if less than 2 hours old to prevent SMS spam
          if (cachedBill && (new Date().getTime() - cachedBill.updatedAt.getTime() < 7200000)) {
            console.log(`Returning fresh cached bill data for ${telephoneNumber}`);
            results.push({
              telephoneNumber,
              bill: cachedBill,
              source: 'cache'
            });
            continue;
          }
        } catch (error: any) {
          console.error(`Cache error for ${telephoneNumber}:`, error.message);
        }
      }
    }

    // Get numbers that need API calls (not in cache or cache expired)
    const numbersNeedingApi = telephoneNumbers.filter(
      num => !results.find(r => r.telephoneNumber === num)
    );

    if (numbersNeedingApi.length > 0) {
      try {
        // Fetch bill information from SLT API for multiple numbers
        console.log(`Fetching bills from SLT API for: ${numbersNeedingApi.join(', ')} with mobile: ${mobileNumber}`);
        const multiResult = await fetchMultipleBillsFromSltApi(numbersNeedingApi, mobileNumber);

        // Process successful bills
        for (const sltBillInfo of multiResult.bills) {
          try {
            // Normalize the data
            const normalizedData = normalizeSltBillData(sltBillInfo, sltBillInfo.sltNumber!);

            // Cache the bill information in database (upsert)
            const bill = await prisma.sltBill.upsert({
              where: { telephoneNumber: sltBillInfo.sltNumber! },
              update: {
                ...normalizedData,
                updatedAt: new Date(),
              },
              create: {
                ...normalizedData,
              },
              select: {
                id: true,
                telephoneNumber: true,
                mobileNumber: true,
                accountName: true,
                accountAddress: true,
                currentBill: true,
                dueDate: true,
                status: true,
                lastPaymentDate: true,
              }
            });

            results.push({
              telephoneNumber: sltBillInfo.sltNumber!,
              bill,
              source: 'slt_api'
            });

            smsNotifications.push({
              telephoneNumber: sltBillInfo.sltNumber!,
              sent: true,
              message: sltBillInfo.message || 'Bill details sent to registered mobile number',
              maskedMobile: sltBillInfo.maskedMobile,
              referenceId: sltBillInfo.referenceId
            });
          } catch (dbError: any) {
            console.error(`Database error for ${sltBillInfo.sltNumber}:`, dbError.message);
            errors.push({
              telephoneNumber: sltBillInfo.sltNumber!,
              error: 'Failed to save bill information'
            });
          }
        }

        // Process API errors
        errors.push(...multiResult.errors);

      } catch (apiError: any) {
        console.error('SLT API batch error, checking local cache:', apiError.message);
        
        // If API fails completely, try to get cached data for remaining numbers
        for (const telephoneNumber of numbersNeedingApi) {
          try {
            const cachedBill = await prisma.sltBill.findUnique({
              where: { telephoneNumber },
              select: {
                id: true,
                telephoneNumber: true,
                mobileNumber: true,
                accountName: true,
                accountAddress: true,
                currentBill: true,
                dueDate: true,
                status: true,
                lastPaymentDate: true,
                updatedAt: true,
              }
            });

            if (cachedBill) {
              console.log(`Returning old cached bill data for ${telephoneNumber}`);
              results.push({
                telephoneNumber,
                bill: cachedBill,
                source: 'cache',
                warning: 'Bill information may not be current. SLT API temporarily unavailable.'
              });
            } else {
              errors.push({
                telephoneNumber,
                error: 'No cached data available and SLT API is unavailable'
              });
            }
          } catch (cacheError: any) {
            errors.push({
              telephoneNumber,
              error: 'Failed to retrieve cached data'
            });
          }
        }
      }
    }

    res.json({
      success: results.length > 0,
      results,
      smsNotifications,
      errors,
      summary: {
        total: telephoneNumbers.length,
        successful: results.length,
        failed: errors.length
      }
    });

  } catch (error: any) {
    console.error('Error verifying multiple telephone numbers:', error);
    res.status(500).json({ error: error.message || 'Failed to verify telephone numbers' });
  }
});

// GET /api/bills/verify/:telephoneNumber - Verify SLT telephone number and get bill details
router.get('/verify/:telephoneNumber', async (req: Request, res: Response) => {
  try {
    const { telephoneNumber } = req.params;
    const mobileNumber = req.query.mobileNumber as string | undefined;

    // Relaxed validation: Just check for 10 digits
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(telephoneNumber)) {
      return res.status(400).json({
        error: 'Invalid telephone number. Must be 10 digits.'
      });
    }

    try {
      const forceRefresh = req.query.force === 'true';

      // ── Rate limit: max BILL_SMS_DAILY_LIMIT bill SMS enquiries per mobile per day ──
      if (mobileNumber) {
        const mobileRegex = /^\d{9,12}$/;
        if (!mobileRegex.test(mobileNumber)) {
          return res.status(400).json({
            error: 'Invalid mobileNumber. Must be strictly 9 to 12 digits (numeric only).'
          });
        }
        const rateCheck = await checkAndIncrementBillSmsRateLimit(mobileNumber, true);
        if (!rateCheck.allowed) {
          console.warn(`[BILL][RATE-LIMIT] Mobile ${mobileNumber} exceeded daily bill SMS limit (${rateCheck.count}/${rateCheck.limit})`);
          return res.status(429).json({
            error: `Daily bill enquiry limit reached. For privacy protection, each mobile number can only request bill details ${BILL_SMS_DAILY_LIMIT} times per day. Please try again tomorrow.`,
            rateLimited: true,
            limit: rateCheck.limit,
            count: rateCheck.count,
            remaining: rateCheck.remaining,
          });
        }
        console.log(`[BILL][RATE-LIMIT] Mobile ${mobileNumber}: ${rateCheck.count}/${rateCheck.limit} enquiries today`);
      }

      // Avoid excessive SLT API calls by checking cache first,
      // but ONLY if force refresh isn't requested AND no mobile number is provided
      if (!forceRefresh && !mobileNumber) {
        const cachedBill = await prisma.sltBill.findUnique({
          where: { telephoneNumber },
          select: {
            id: true,
            telephoneNumber: true,
            mobileNumber: true,
            accountName: true,
            accountAddress: true,
            currentBill: true,
            dueDate: true,
            status: true,
            lastPaymentDate: true,
            updatedAt: true,
          }
        });

        // Use cache if less than 2 hours old to prevent SMS spam
        if (cachedBill && (new Date().getTime() - cachedBill.updatedAt.getTime() < 7200000)) {
          console.log(`Returning fresh cached bill data for ${telephoneNumber}`);
          return res.json({
            success: true,
            bill: cachedBill,
            source: 'cache',
          });
        }
      }

      // Fetch bill information from SLT API
      console.log(`Fetching bill from SLT API for: ${telephoneNumber} with mobile: ${mobileNumber}`);
      const sltBillInfo = await fetchBillFromSltApi(telephoneNumber, mobileNumber);

      // Normalize the data (pass the queried number to ensure consistency)
      const normalizedData = normalizeSltBillData(sltBillInfo, telephoneNumber);

      // Cache the bill information in database (upsert)
      const bill = await prisma.sltBill.upsert({
        where: { telephoneNumber },
        update: {
          ...normalizedData,
          updatedAt: new Date(),
        },
        create: {
          ...normalizedData,
        },
        select: {
          id: true,
          telephoneNumber: true,
          mobileNumber: true,
          accountName: true,
          accountAddress: true,
          currentBill: true,
          dueDate: true,
          status: true,
          lastPaymentDate: true,
        }
      });

      res.json({
        success: true,
        bill,
        source: 'slt_api',
        smsNotification: {
          sent: true,
          message: sltBillInfo.message || 'Bill details sent to registered mobile number',
          maskedMobile: sltBillInfo.maskedMobile,
          referenceId: sltBillInfo.referenceId
        }
      });

    } catch (apiError: any) {
      console.error('SLT API error, checking local cache:', apiError.message);

      // If API fails, try to get cached data from database
      const cachedBill = await prisma.sltBill.findUnique({
        where: { telephoneNumber },
        select: {
          id: true,
          telephoneNumber: true,
          mobileNumber: true,
          accountName: true,
          accountAddress: true,
          currentBill: true,
          dueDate: true,
          status: true,
          lastPaymentDate: true,
          updatedAt: true,
        }
      });

      if (cachedBill) {
        console.log('Returning cached bill data');
        return res.json({
          success: true,
          bill: cachedBill,
          source: 'cache', // Indicate data is from cache
          warning: 'Bill information may not be current. SLT API temporarily unavailable.'
        });
      }

      // If no cached data and API failed, return error
      return res.status(404).json({
        error: apiError.message || 'No account found for this telephone number.'
      });
    }

  } catch (error: any) {
    console.error('Error verifying telephone number:', error);
    res.status(500).json({ error: error.message || 'Failed to verify telephone number' });
  }
});

// POST /api/bills/search - Search bill by telephone number (alternative endpoint)
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { telephoneNumber, mobileNumber } = req.body;

    if (!telephoneNumber) {
      return res.status(400).json({ error: 'Telephone number is required' });
    }

    // Relaxed validation: Just check for 10 digits
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(telephoneNumber)) {
      return res.status(400).json({
        error: 'Invalid telephone number. Must be 10 digits.'
      });
    }

    try {
      const forceRefresh = req.query.force === 'true';

      if (!forceRefresh) {
        const cachedBill = await prisma.sltBill.findUnique({
          where: { telephoneNumber },
          select: {
            id: true,
            telephoneNumber: true,
            mobileNumber: true,
            accountName: true,
            accountAddress: true,
            currentBill: true,
            dueDate: true,
            status: true,
            lastPaymentDate: true,
            updatedAt: true,
          }
        });

        if (cachedBill && (new Date().getTime() - cachedBill.updatedAt.getTime() < 7200000)) {
          console.log(`Returning fresh cached bill data for ${telephoneNumber}`);
          return res.json({
            success: true,
            bill: cachedBill,
            source: 'cache',
          });
        }
      }

      // Fetch bill information from SLT API
      console.log(`Searching bill from SLT API for: ${telephoneNumber} with mobile: ${mobileNumber}`);
      const sltBillInfo = await fetchBillFromSltApi(telephoneNumber, mobileNumber);

      // Normalize the data (pass the queried number to ensure consistency)
      const normalizedData = normalizeSltBillData(sltBillInfo, telephoneNumber);

      // Cache the bill information in database (upsert)
      const bill = await prisma.sltBill.upsert({
        where: { telephoneNumber },
        update: {
          ...normalizedData,
          updatedAt: new Date(),
        },
        create: {
          ...normalizedData,
        },
        select: {
          id: true,
          telephoneNumber: true,
          mobileNumber: true,
          accountName: true,
          accountAddress: true,
          currentBill: true,
          dueDate: true,
          status: true,
          lastPaymentDate: true,
        }
      });

      res.json({
        success: true,
        bill,
        source: 'slt_api',
        smsNotification: {
          sent: true,
          message: sltBillInfo.message || 'Bill details sent to registered mobile number',
          maskedMobile: sltBillInfo.maskedMobile,
          referenceId: sltBillInfo.referenceId
        }
      });

    } catch (apiError: any) {
      console.error('SLT API error, checking local cache:', apiError.message);

      // If API fails, try to get cached data from database
      const cachedBill = await prisma.sltBill.findUnique({
        where: { telephoneNumber },
        select: {
          id: true,
          telephoneNumber: true,
          mobileNumber: true,
          accountName: true,
          accountAddress: true,
          currentBill: true,
          dueDate: true,
          status: true,
          lastPaymentDate: true,
          updatedAt: true,
        }
      });

      if (cachedBill) {
        console.log('Returning cached bill data');
        return res.json({
          success: true,
          bill: cachedBill,
          source: 'cache',
          warning: 'Bill information may not be current. SLT API temporarily unavailable.'
        });
      }

      // If no cached data and API failed, return error
      return res.status(404).json({
        error: apiError.message || 'No account found for this telephone number.'
      });
    }

  } catch (error: any) {
    console.error('Error searching bill:', error);
    res.status(500).json({ error: error.message || 'Failed to search bill' });
  }
});

// GET /api/bills/all - Get all bills (for admin purposes)
router.get('/all', async (req: Request, res: Response) => {
  try {
    const { status, limit = '50' } = req.query;

    const where: any = {};
    if (status && typeof status === 'string') {
      where.status = status;
    }

    const bills = await prisma.sltBill.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      take: parseInt(limit as string),
      select: {
        id: true,
        telephoneNumber: true,
        accountName: true,
        currentBill: true,
        dueDate: true,
        status: true,
      }
    });

    res.json({ bills, total: bills.length });

  } catch (error) {
    console.error('Error fetching bills:', error);
    res.status(500).json({ error: 'Failed to fetch bills' });
  }
});

// POST /api/bills/send-notification - Send bill details via SMS to customer's mobile
// Send bill notification to registered owner using SLT API
router.post('/send-bill-notification', async (req: Request, res: Response) => {
  try {
    const { sltTelephoneNumbers, mobileNumber } = req.body;

    if (!sltTelephoneNumbers || !Array.isArray(sltTelephoneNumbers) || sltTelephoneNumbers.length === 0) {
      return res.status(400).json({ error: 'sltTelephoneNumbers array is required' });
    }

    // Validate telephone numbers format to reject alphanumeric or special characters
    const phoneRegex = /^\d{10}$/;
    const invalidNumbers = sltTelephoneNumbers.filter(num => typeof num !== 'string' || !phoneRegex.test(num));
    if (invalidNumbers.length > 0) {
      return res.status(400).json({
        error: `Invalid SLT telephone numbers. Must be strictly 10 digits: ${invalidNumbers.join(', ')}`
      });
    }

    // Validate mobileNumber if provided to reject alphanumeric or special characters
    if (mobileNumber) {
      const mobileRegex = /^\d{9,12}$/;
      if (!mobileRegex.test(mobileNumber)) {
        return res.status(400).json({
          error: 'Invalid mobileNumber. Must be strictly 9 to 12 digits (numeric only).'
        });
      }
    }

    // Send notification for each telephone number
    const results = await Promise.all(
      sltTelephoneNumbers.map(async (sltNumber: string) => {
        const result = await sltBillingService.sendBillNotificationToOwner(sltNumber, mobileNumber);
        return {
          sltNumber,
          ...result
        };
      })
    );

    // Check if all notifications were sent successfully
    const allSuccess = results.every(result => result.success);
    const successCount = results.filter(result => result.success).length;

    console.log(`[BILL] Sent notifications to ${successCount}/${results.length} SLT accounts`);

    res.json({
      success: true,
      message: `Notifications sent to ${successCount}/${results.length} accounts`,
      results
    });

  } catch (error) {
    console.error('Error sending bill notifications:', error);
    res.status(500).json({ error: 'Failed to send bill notifications' });
  }
});

router.post('/send-notification', async (req: Request, res: Response) => {
  try {
    const { mobileNumber, accountName, billAmount, dueDate, sltNumber, language = 'en' } = req.body;

    if (!mobileNumber || !accountName || billAmount === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate mobileNumber to reject alphanumeric or special characters
    const mobileRegex = /^\d{9,12}$/;
    if (typeof mobileNumber !== 'string' || !mobileRegex.test(mobileNumber)) {
      return res.status(400).json({ error: 'Invalid mobileNumber. Must be strictly 9 to 12 digits (numeric only).' });
    }

    // Validate sltNumber (if provided) to be exactly 10 digits
    if (sltNumber) {
      const sltRegex = /^\d{10}$/;
      if (typeof sltNumber !== 'string' || !sltRegex.test(sltNumber)) {
        return res.status(400).json({ error: 'Invalid sltNumber. Must be strictly 10 digits (numeric only).' });
      }
    }

    // Validate billAmount is strictly numeric to prevent alphanumeric injection
    const amountStr = String(billAmount);
    const amountRegex = /^\d+(\.\d{1,2})?$/;
    if (!amountRegex.test(amountStr)) {
      return res.status(400).json({ error: 'Invalid billAmount format. Must be strictly numeric.' });
    }

    // Validate dueDate if provided to prevent date/time string injection
    if (dueDate) {
      const dateStr = String(dueDate);
      const dateRegex = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{4}$/;
      if (!dateRegex.test(dateStr) && isNaN(Date.parse(dateStr))) {
        return res.status(400).json({ error: 'Invalid dueDate format.' });
      }
    }

    // Validate accountName strictly to reject script/HTML tags (prevent XSS / CSS injection)
    if (typeof accountName !== 'string') {
      return res.status(400).json({ error: 'accountName must be a string.' });
    }
    const safeNameRegex = /^[A-Za-z0-9\s.,/\-()&]+$/;
    if (!safeNameRegex.test(accountName)) {
      return res.status(400).json({
        error: 'Invalid characters in accountName. Only alphanumeric and standard name characters are allowed to prevent injection.'
      });
    }

    // Format bill amount and due date
    const formattedAmount = parseFloat(billAmount).toFixed(2);
    const dueDateFormatted = dueDate ? new Date(dueDate).toLocaleDateString() : 'N/A';

    // Try to send SMS notification using unified SMS helper
    try {
      const result = await smsHelper.sendBillNotification(mobileNumber, {
        accountName,
        amount: formattedAmount,
        dueDate: dueDateFormatted,
        accountNumber: sltNumber
      }, language as 'en' | 'si' | 'ta');

      if (result.success) {
        console.log(`[BILL][SMS] Sent bill notification via ${result.provider} to ${mobileNumber}`);
      } else {
        console.warn('[BILL][SMS] Failed to send notification:', result.error);
      }
    } catch (smsErr: any) {
      console.log(`[BILL][SMS] Notification failed (non-critical):`, smsErr.message);
      // Don't fail the request if SMS fails
    }

    res.json({
      success: true,
      message: 'Notification sent successfully'
    });

  } catch (error) {
    console.error('Error sending notification:', error);
    // Still return success even if there's an error (notification is non-critical)
    res.json({
      success: true,
      message: 'Notification processed'
    });
  }
});

export default router;
