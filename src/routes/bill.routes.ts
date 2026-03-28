import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { fetchBillFromSltApi, fetchMultipleBillsFromSltApi, normalizeSltBillData } from '../services/sltBillingService';
import * as sltBillingService from '../services/sltBillingService';
import smsHelper from '../utils/smsHelper';

const router = Router();
const prisma = new PrismaClient();

// POST /api/bills/verify-multiple - Verify multiple SLT telephone numbers and get bill details
router.post('/verify-multiple', async (req: Request, res: Response) => {
  try {
    const { telephoneNumbers } = req.body;

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

    const forceRefresh = req.query.force === 'true';
    const results: any[] = [];
    const smsNotifications: any[] = [];
    const errors: any[] = [];

    // Check cache first if not forcing refresh
    if (!forceRefresh) {
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
        console.log(`Fetching bills from SLT API for: ${numbersNeedingApi.join(', ')}`);
        const multiResult = await fetchMultipleBillsFromSltApi(numbersNeedingApi);

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

    // Relaxed validation: Just check for 10 digits
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(telephoneNumber)) {
      return res.status(400).json({
        error: 'Invalid telephone number. Must be 10 digits.'
      });
    }

    try {
      // Avoid excessive SLT API calls (which trigger SMS) by checking cache first
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
      console.log(`Fetching bill from SLT API for: ${telephoneNumber}`);
      const sltBillInfo = await fetchBillFromSltApi(telephoneNumber);

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
    const { telephoneNumber } = req.body;

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
      console.log(`Searching bill from SLT API for: ${telephoneNumber}`);
      const sltBillInfo = await fetchBillFromSltApi(telephoneNumber);

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
    const { sltTelephoneNumbers } = req.body;

    if (!sltTelephoneNumbers || !Array.isArray(sltTelephoneNumbers) || sltTelephoneNumbers.length === 0) {
      return res.status(400).json({ error: 'sltTelephoneNumbers array is required' });
    }

    // Send notification for each telephone number
    const results = await Promise.all(
      sltTelephoneNumbers.map(async (sltNumber: string) => {
        const result = await sltBillingService.sendBillNotificationToOwner(sltNumber);
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
