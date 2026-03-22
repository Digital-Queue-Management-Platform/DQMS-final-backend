/**
 * Normalize Sri Lankan mobile numbers to a consistent 10-digit format (e.g., 0771234567)
 */
export function normalizeMobile(mobile: string | undefined | null): string {
  if (!mobile) return ''
  
  // Remove all non-digit characters
  let digits = mobile.replace(/\D/g, '')
  
  // Handle 94...
  if (digits.startsWith('94') && digits.length === 11) {
    return '0' + digits.substring(2)
  }
  
  // Handle 0...
  if (digits.startsWith('0') && digits.length === 10) {
    return digits
  }
  
  // Handle 7... (9 digits)
  if (digits.length === 9) {
    return '0' + digits
  }
  
  return digits
}
