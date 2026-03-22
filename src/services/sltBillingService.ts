import axios from 'axios';

// SLT Billing API Configuration
const SLT_BILLING_API_URL = 'https://omnilogin.slt.lk/DigitalQMS/api/Main/SendBillInfo';

// Types for SLT API Response
interface SltBillInfo {
  sltNumber?: string;
  accountName?: string;
  accountAddress?: string;
  mobileNumber?: string;
  maskedMobile?: string | null;
  currentBill?: number;
  dueDate?: string;
  status?: string;
  lastPaymentDate?: string;
  isSuccess?: boolean;
  message?: string;
  referenceId?: string;
  [key: string]: any;
}

interface SltApiResponse {
  isSuccess?: boolean;
  dataBundle?: string;
  errorMessege?: string;
  errorShow?: string;
  data?: SltBillInfo;
  [key: string]: any;
}

/**
 * Fetch bill information from SLT API
 * @param sltNumber - SLT telephone number (e.g., "0112123456")
 * @param senderMobile - Optional mobile number of the person requesting
 * @returns Bill information from SLT API
 */
export async function fetchBillFromSltApi(sltNumber: string, senderMobile?: string): Promise<SltBillInfo> {
  try {
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(sltNumber)) {
      throw new Error('Invalid telephone number. Must be 10 digits.');
    }

    console.log(`Fetching bill info for SLT number: ${sltNumber}${senderMobile ? ` (sender: ${senderMobile})` : ''}`);

    const response = await axios.post<SltApiResponse>(
      `${SLT_BILLING_API_URL}?sltNumber=${sltNumber}`,
      {
        sltNumber: sltNumber,
        senderMobile: senderMobile || "",
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      }
    );

    if (response.data) {
      if (response.data.isSuccess === false) {
        const errorMsg = response.data.errorMessege || response.data.errorShow || 'Account not found';
        throw new Error(errorMsg);
      }

      const data = response.data.data || response.data || {};

      return {
        ...data,
        sltNumber: sltNumber,
        isSuccess: response.data.isSuccess,
        message: response.data.errorMessege || 'Bill details sent successfully',
        referenceId: response.data.dataBundle,
        currentBill: data.currentBill || data.billAmount || response.data.currentBill || 0,
        accountName: data.accountName || response.data.accountName || 'Verified Account',
        dueDate: data.dueDate || response.data.dueDate || new Date().toISOString(),
        maskedMobile: data.maskedMobile || extractMaskedMobile(response.data.errorMessege || ''),
      } as SltBillInfo;
    }

    throw new Error('No response received from SLT API');

  } catch (error: any) {
    console.error('Error fetching bill from SLT API:', error.message);

    if (axios.isAxiosError(error)) {
      if (error.response) {
        const statusCode = error.response.status;
        const errorMessage = error.response.data?.error || error.response.data?.message || error.message;

        if (statusCode === 404) {
          throw new Error('No account found for this telephone number');
        } else if (statusCode === 400) {
          throw new Error(`Invalid request: ${errorMessage}`);
        } else {
          throw new Error(`SLT API error (${statusCode}): ${errorMessage}`);
        }
      } else if (error.request) {
        throw new Error('No response from SLT API. Please try again later.');
      }
    }

    throw new Error(error.message || 'Failed to fetch bill information');
  }
}

/**
 * Extract masked mobile number from API message
 */
function extractMaskedMobile(message: string): string | null {
  const match = message.match(/\*+\d+/);
  return match ? match[0] : null;
}

/**
 * Normalize and map SLT API response to our database schema
 */
export function normalizeSltBillData(sltBillInfo: SltBillInfo, queriedNumber: string, unmaskedMobile?: string) {
  let resolvedMobile = (sltBillInfo.mobileNumber && !sltBillInfo.mobileNumber.includes('*'))
    ? sltBillInfo.mobileNumber
    : (sltBillInfo.maskedMobile || (sltBillInfo.isSuccess ? '******' : null));

  if (unmaskedMobile && resolvedMobile && resolvedMobile.includes('*')) {
    const visiblePart = resolvedMobile.replace(/\*+/g, '');
    if (visiblePart && unmaskedMobile.endsWith(visiblePart)) {
      resolvedMobile = unmaskedMobile;
    }
  }

  return {
    telephoneNumber: queriedNumber,
    mobileNumber: resolvedMobile,
    accountName: sltBillInfo.accountName || 'Verified Account',
    accountAddress: sltBillInfo.accountAddress || null,
    currentBill: typeof sltBillInfo.currentBill === 'number' ? sltBillInfo.currentBill : 0,
    dueDate: sltBillInfo.dueDate ? new Date(sltBillInfo.dueDate) : new Date(),
    status: 'sms_sent',
    lastPaymentDate: sltBillInfo.lastPaymentDate ? new Date(sltBillInfo.lastPaymentDate) : null,
  };
}
