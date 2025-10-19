import crypto from 'crypto'

/**
 * Generates a secure 8-character password with uppercase, lowercase, numbers, and symbols
 */
export function generateSecurePassword(): string {
  // Define character sets
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lowercase = 'abcdefghijklmnopqrstuvwxyz'
  const numbers = '0123456789'
  const symbols = '!@#$%&*'
  
  // Ensure at least one character from each category
  let password = ''
  
  // Add one character from each required category
  password += getRandomChar(uppercase)
  password += getRandomChar(lowercase)
  password += getRandomChar(numbers)
  password += getRandomChar(symbols)
  
  // Fill the remaining 4 characters with random characters from all sets
  const allChars = uppercase + lowercase + numbers + symbols
  for (let i = 4; i < 8; i++) {
    password += getRandomChar(allChars)
  }
  
  // Shuffle the password to randomize the position of guaranteed characters
  return shuffleString(password)
}

/**
 * Get a random character from a string using crypto.randomInt for better security
 */
function getRandomChar(str: string): string {
  const randomIndex = crypto.randomInt(0, str.length)
  return str[randomIndex]
}

/**
 * Shuffle string characters using Fisher-Yates algorithm with crypto random
 */
function shuffleString(str: string): string {
  const arr = str.split('')
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.join('')
}

/**
 * Validate password strength (for testing purposes)
 */
export function validatePasswordStrength(password: string): boolean {
  const hasUppercase = /[A-Z]/.test(password)
  const hasLowercase = /[a-z]/.test(password)
  const hasNumbers = /[0-9]/.test(password)
  const hasSymbols = /[!@#$%&*]/.test(password)
  const isCorrectLength = password.length === 8
  
  return hasUppercase && hasLowercase && hasNumbers && hasSymbols && isCorrectLength
}

/**
 * Generate multiple passwords and test them (for development/testing)
 */
export function testPasswordGeneration(count: number = 10): void {
  console.log(`\n🔐 Testing ${count} generated passwords:`)
  console.log('─'.repeat(50))
  
  for (let i = 1; i <= count; i++) {
    const password = generateSecurePassword()
    const isValid = validatePasswordStrength(password)
    console.log(`${i.toString().padStart(2)}: ${password} ${isValid ? '✅' : '❌'}`)
  }
  
  console.log('─'.repeat(50))
  console.log('✅ All passwords should be 8 characters with uppercase, lowercase, numbers, and symbols')
}