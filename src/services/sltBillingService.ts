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
  // Add other fields returned by the API
  [key: string]: any;
}

interface SltApiResponse {
  success?: boolean;
  data?: SltBillInfo;
  message?: string;
  error?: string;
  // Add other fields based on actual API response
  [key: string]: any;
}

/**
 * Fetch bill information from SLT API
 * @param sltNumber - SLT telephone number (e.g., "0112123456")
 * @returns Bill information from SLT API
 */
export async function fetchBillFromSltApi(sltNumber: string): Promise<SltBillInfo> {
  try {
    // Validate SLT number format (SLT numbers: 10 digits starting with 01, 041, or 081)
    const phoneRegex = /^(01\d{8}|041\d{7}|081\d{7})$/;
    if (!phoneRegex.test(sltNumber)) {
      throw new Error('Invalid SLT telephone number. Must be 10 digits starting with 01, 041, or 081.');
    }

    console.log(`Fetching bill info for SLT number: ${sltNumber}`);

    // Make request to SLT API
    const response = await axios.post<SltApiResponse>(
      `${SLT_BILLING_API_URL}?sltNumber=${sltNumber}`,
      {
        sltNumber: sltNumber,
        // Some APIs might need additional fields - uncomment if needed:
        // senderMobile: "", // May need to pass this if required
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      }
    );

    console.log('==========================================');
    console.log('SLT API Full Response:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('==========================================');

    // Handle SLT API response structure
    if (response.data) {
      // Check if the request was successful
      if (response.data.isSuccess === false) {
        const errorMsg = response.data.errorMessege || response.data.errorShow || 'Account not found';
        throw new Error(errorMsg);
      }

      // The API sends SMS to registered mobile and returns success info
      // Extract relevant information
      return {
        sltNumber: sltNumber,
        isSuccess: response.data.isSuccess,
        message: response.data.errorMessege || 'Bill details sent successfully',
        referenceId: response.data.dataBundle,
        // Extract masked mobile number from message if available
        maskedMobile: extractMaskedMobile(response.data.errorMessege || ''),
      } as SltBillInfo;
    }

    throw new Error('No response received from SLT API');

  } catch (error: any) {
    console.error('Error fetching bill from SLT API:', error.message);
    
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
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
        // The request was made but no response was received
        throw new Error('No response from SLT API. Please try again later.');
      }
    }

    throw new Error(`Failed to fetch bill information: ${error.message}`);
  }
}

/**
 * Extract masked mobile number from API message
 * e.g., "...ending with ******9227" -> "******9227"
 */
function extractMaskedMobile(message: string): string | null {
  const match = message.match(/\*+\d{4}/);
  return match ? match[0] : null;
}

/**
 * Normalize and map SLT API response to our database schema
 * @param sltBillInfo - Bill info from SLT API
 * @param queriedNumber - The telephone number that was queried (to ensure consistency)
 * @returns Normalized bill data
 */
export function normalizeSltBillData(sltBillInfo: SltBillInfo, queriedNumber: string) {
  return {
    telephoneNumber: queriedNumber, // Use the queried number to avoid constraint violations
    mobileNumber: sltBillInfo.maskedMobile || sltBillInfo.mobileNumber || null,
    accountName: sltBillInfo.accountName || 'Verified Account',
    accountAddress: sltBillInfo.accountAddress || null,
    currentBill: typeof sltBillInfo.currentBill === 'number' 
      ? sltBillInfo.currentBill 
      : 0, // Bill amount sent via SMS, not returned in API
    dueDate: sltBillInfo.dueDate ? new Date(sltBillInfo.dueDate) : new Date(),
    status: 'sms_sent', // Indicate that bill was sent via SMS
    lastPaymentDate: sltBillInfo.lastPaymentDate ? new Date(sltBillInfo.lastPaymentDate) : null,
  };
}
