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

export default router;
