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

interface MultiBillResult {
  success: boolean;
  bills: SltBillInfo[];
  errors: { phoneNumber: string; error: string }[];
}

/**
 * Fetch bill information from SLT API for multiple telephone numbers
 * @param sltNumbers - Array of SLT telephone numbers (e.g., ["0112123456", "0112123457"])
 * @returns Results for all telephone numbers with success/error status
 */
export async function fetchMultipleBillsFromSltApi(sltNumbers: string[], mobileNumber?: string): Promise<MultiBillResult> {
  const bills: SltBillInfo[] = [];
  const errors: { phoneNumber: string; error: string }[] = [];

  // Process each number sequentially to avoid overwhelming the API
  for (const sltNumber of sltNumbers) {
    try {
      const billInfo = await fetchBillFromSltApi(sltNumber, mobileNumber);
      bills.push(billInfo);
    } catch (error: any) {
      console.error(`Error fetching bill for ${sltNumber}:`, error.message);
      errors.push({
        phoneNumber: sltNumber,
        error: error.message || 'Failed to fetch bill information'
      });
    }

    // Add a small delay to prevent API rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return {
    success: bills.length > 0,
    bills,
    errors
  };
}

/**
 * Fetch bill information from SLT API
 * @param sltNumber - SLT telephone number (e.g., "0112123456")
 * @returns Bill information from SLT API
 */
export async function fetchBillFromSltApi(sltNumber: string, mobileNumber?: string): Promise<SltBillInfo> {
  try {
    // Relaxed validation: Just check for 10 digits
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(sltNumber)) {
      throw new Error('Invalid telephone number. Must be 10 digits.');
    }

    console.log(`Fetching bill info for SLT number: ${sltNumber}`);

    // Determine endpoint based on presence of mobileNumber
    const url = mobileNumber
      ? `https://omnilogin.slt.lk/DigitalQMS/api/Main/SendBillInfoV2?sltNumber=${sltNumber}&mobileNumber=${mobileNumber}`
      : `${SLT_BILLING_API_URL}?sltNumber=${sltNumber}`;

    const payload = { sltNumber: sltNumber };

    // Make request to SLT API
    const response = await axios.post<SltApiResponse>(
      url,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
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
 * Send bill notification to registered owner using SLT API
 * This triggers SLT to send due amount SMS to the account holder
 * @param sltNumber - SLT telephone number (e.g., "0412255897")
 * @returns Success status from SLT API
 */
export async function sendBillNotificationToOwner(sltNumber: string, mobileNumber?: string): Promise<{ success: boolean; message?: string }> {
  try {
    // Validate telephone number format
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(sltNumber)) {
      throw new Error('Invalid telephone number. Must be 10 digits.');
    }

    console.log(`Sending bill notification for SLT number: ${sltNumber}`);

    const url = mobileNumber
      ? `https://omnilogin.slt.lk/DigitalQMS/api/Main/SendBillInfoV2?sltNumber=${sltNumber}&mobileNumber=${mobileNumber}`
      : `https://omnilogin.slt.lk/DigitalQMS/api/Main/SendBillInfo?sltNumber=${sltNumber}`;

    const payload = { sltNumber: sltNumber };

    // Make request to SLT SendBillInfo API to trigger SMS 
    const response = await axios.post(
      url,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
      }
    );

    console.log(`SLT Bill Notification API response for ${sltNumber}:`, response.status, response.data);

    // Check if the response indicates success
    if (response.status === 200) {
      return {
        success: true,
        message: `Bill notification sent to registered owner of ${sltNumber}`
      };
    } else {
      return {
        success: false,
        message: `Failed to send notification: HTTP ${response.status}`
      };
    }

  } catch (error: any) {
    console.error(`Error sending bill notification for ${sltNumber}:`, error.message);
    
    if (error.response) {
      const statusCode = error.response.status;
      const errorMessage = error.response.data?.message || error.response.data?.error || 'Unknown error';
      
      return {
        success: false,
        message: `SLT API error (${statusCode}): ${errorMessage}`
      };
    } else if (error.request) {
      return {
        success: false,
        message: 'No response from SLT API. Please try again later.'
      };
    }

    return {
      success: false,
      message: `Failed to send bill notification: ${error.message}`
    };
  }
}

/**
 * Extract masked mobile number from API message
 * e.g., "...ending with ******9227" -> "******9227"
 */
function extractMaskedMobile(message: string): string | null {
  // Matches patterns like ******9227, 07*******12, etc.
  const match = message.match(/\*+\d+/);
  return match ? match[0] : null;
}

/**
 * Normalize and map SLT API response to our database schema
 * @param sltBillInfo - Bill info from SLT API
 * @param queriedNumber - The telephone number that was queried (to ensure consistency)
 * @returns Normalized bill data
 */
export function normalizeSltBillData(sltBillInfo: SltBillInfo, queriedNumber: string) {
  // If we have a full mobile number, use it.
  // Otherwise, use the masked one. 
  // If even masked is missing but API was successful, use a placeholder to bypass frontend gaps.
  const resolvedMobile = (sltBillInfo.mobileNumber && !sltBillInfo.mobileNumber.includes('*'))
    ? sltBillInfo.mobileNumber
    : (sltBillInfo.maskedMobile || (sltBillInfo.isSuccess ? '******' : null));

  return {
    telephoneNumber: queriedNumber, // Use the queried number to avoid constraint violations
    mobileNumber: resolvedMobile,
    accountName: sltBillInfo.accountName || 'Verified Account',
    accountAddress: sltBillInfo.accountAddress || null,
    currentBill: sltBillInfo.currentBill !== undefined && sltBillInfo.currentBill !== null
      ? parseFloat(String(sltBillInfo.currentBill))
      : 0, // Bill amount sent via SMS, not returned in API
    dueDate: sltBillInfo.dueDate ? new Date(sltBillInfo.dueDate) : new Date(),
    status: 'sms_sent', // Indicate that bill was sent via SMS
    lastPaymentDate: sltBillInfo.lastPaymentDate ? new Date(sltBillInfo.lastPaymentDate) : null,
  };
}
