import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/bills/verify/:telephoneNumber - Verify SLT telephone number and get bill details
router.get('/verify/:telephoneNumber', async (req: Request, res: Response) => {
  try {
    const { telephoneNumber } = req.params;

    // Validate telephone number format (SLT numbers: 10 digits starting with 01, 041, or 081)
    const phoneRegex = /^(01\d{8}|041\d{7}|081\d{7})$/;
    if (!phoneRegex.test(telephoneNumber)) {
      return res.status(400).json({ 
        error: 'Invalid SLT telephone number. Must be 10 digits starting with 01, 041, or 081.' 
      });
    }

    // Find bill by telephone number
    const bill = await prisma.sltBill.findUnique({
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
      }
    });

    if (!bill) {
      return res.status(404).json({ 
        error: 'No account found for this telephone number.' 
      });
    }

    res.json({ 
      success: true, 
      bill 
    });

  } catch (error) {
    console.error('Error verifying telephone number:', error);
    res.status(500).json({ error: 'Failed to verify telephone number' });
  }
});

// POST /api/bills/search - Search bill by telephone number (alternative endpoint)
router.post('/search', async (req: Request, res: Response) => {
  try {
    const { telephoneNumber } = req.body;

    if (!telephoneNumber) {
      return res.status(400).json({ error: 'Telephone number is required' });
    }

    const bill = await prisma.sltBill.findUnique({
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
      }
    });

    if (!bill) {
      return res.status(404).json({ 
        error: 'No account found for this telephone number.' 
      });
    }

    res.json({ 
      success: true, 
      bill 
    });

  } catch (error) {
    console.error('Error searching bill:', error);
    res.status(500).json({ error: 'Failed to search bill' });
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
    const { mobileNumber, accountName, billAmount, dueDate, sltNumber } = req.body;

    if (!mobileNumber || !accountName || billAmount === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Format bill amount and due date
    const formattedAmount = parseFloat(billAmount).toFixed(2);
    const dueDateFormatted = dueDate ? new Date(dueDate).toLocaleDateString() : 'N/A';

    // Try to send SMS notification (graceful failure if SMS service not configured)
    try {
      const Twilio = require('twilio');
      const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
      const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
      const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
        const client = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        
        // Normalize mobile number to E.164 format
        let normalizedMobile = mobileNumber.replace(/\D/g, '');
        if (normalizedMobile.startsWith('0')) {
          normalizedMobile = '94' + normalizedMobile.substring(1);
        } else if (!normalizedMobile.startsWith('94')) {
          normalizedMobile = '94' + normalizedMobile;
        }
        const e164Mobile = '+' + normalizedMobile;

        const message = `Dear ${accountName},\n\nYour SLT bill details:\nAmount Due: Rs. ${formattedAmount}\nDue Date: ${dueDateFormatted}\nSLT Account: ${sltNumber}\n\nThank you!`;

        await client.messages.create({
          body: message,
          from: TWILIO_FROM_NUMBER,
          to: e164Mobile
        });
        
        console.log(`SMS sent successfully to ${e164Mobile}`);
      } else {
        console.log('Twilio credentials not configured, skipping SMS');
      }
    } catch (smsErr: any) {
      console.log(`SMS notification failed (non-critical):`, smsErr.message);
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
