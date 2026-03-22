import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { fetchBillFromSltApi, normalizeSltBillData } from '../services/sltBillingService';
import smsHelper from '../utils/smsHelper';
import { normalizeMobile } from '../utils/phone';

const router = Router();
const prisma = new PrismaClient();

// GET /api/bills/verify/:telephoneNumber - Verify SLT telephone number and get bill details
router.get('/verify/:telephoneNumber', async (req: Request, res: Response) => {
  try {
    const { telephoneNumber } = req.params;
    const { mobileNumber } = req.query; // Optional mobile number of the person requesting

    // Relaxed validation: Just check for 10 digits
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(telephoneNumber)) {
      return res.status(400).json({
        error: 'Invalid telephone number. Must be 10 digits.'
      });
    }

    try {
      // 1. Check local cache first
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

      // Normalized requester mobile

      const nm = normalizeMobile(mobileNumber as string);

      // Cache balancing: 5-minute general cache, but allow bypass for unmasking if not "very fresh"
      const cacheThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes
      const veryFreshThreshold = new Date(Date.now() - 30 * 1000); // 30 seconds

      const isMaskedInCache = cachedBill?.mobileNumber?.includes('*');
      const isNewlyProvidingMobile = !isMaskedInCache && nm && cachedBill?.mobileNumber !== nm; 
      // Bypass cache if:
      // 1. Current cache is masked (contains *) AND we have a potential full mobile number to try.
      // 2. Cache is older than 5 minutes.
      const shouldBypassForUnmasking = isMaskedInCache && mobileNumber;
      const isCacheFresh = cachedBill && cachedBill.updatedAt && cachedBill.updatedAt > cacheThreshold;

      if (isCacheFresh && !shouldBypassForUnmasking) {
        console.log(`[BILL][CACHE] Returning fresh cached data for ${telephoneNumber}`);

        return res.json({
          success: true,
          bill: cachedBill,
          source: 'cache',
          smsNotification: {
            sent: false,
            message: 'Using cached bill details',
            maskedMobile: cachedBill.mobileNumber
          }
        });
      }


      // 2. Fetch bill information from SLT API
      console.log(`Fetching bill from SLT API for: ${telephoneNumber}`);
      const sltBillInfo = await fetchBillFromSltApi(telephoneNumber, mobileNumber as string);

      // Normalize the data (pass the queried number AND the requester's mobile for unmasking)
      const normalizedData = normalizeSltBillData(sltBillInfo, telephoneNumber, mobileNumber as string);

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
      // 1. Check local cache first
      const cacheThreshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes
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

      if (cachedBill && cachedBill.updatedAt && cachedBill.updatedAt > cacheThreshold) {
        console.log(`[BILL][SEARCH][CACHE] Returning fresh cached data for ${telephoneNumber}`);
        return res.json({
          success: true,
          bill: cachedBill,
          source: 'cache',
          smsNotification: {
            sent: false,
            message: 'Using cached bill details (no SMS sent)',
            maskedMobile: cachedBill.mobileNumber
          }
        });
      }

      // 2. Fetch bill information from SLT API if no fresh cache exists
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
      // If mobileNumber is masked (contains * or x), we can't send via our gateway.
      // We should rely on the SLT API's original SMS which already happened on /verify.
      if (mobileNumber.includes('*') || mobileNumber.includes('x')) {
        console.warn(`[BILL][SMS] Cannot send backup notification to masked number: ${mobileNumber}`);
        return res.json({
          success: true,
          message: 'Notification already sent to registered owner by SLT.'
        });
      }

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
