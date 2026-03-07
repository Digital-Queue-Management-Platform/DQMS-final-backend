/**
 * Centralised validation helpers for DQMP backend.
 * Used by all routes to ensure consistent input validation.
 */

/**
 * Validate Sri Lankan mobile number.
 * Accepts: 07XXXXXXXX (10 digits starting with 07)
 * Also accepts: 94XXXXXXXXX (11 digits starting with 94) for international format
 */
export function isValidSLMobile(mobile: string): boolean {
    if (!mobile || typeof mobile !== 'string') return false
    const cleaned = mobile.replace(/\s/g, '')
    // Local format: 07XXXXXXXX (10 digits)
    if (/^07[0-9]{8}$/.test(cleaned)) return true
    // International without +: 94XXXXXXXXX (11 digits)
    if (/^947[0-9]{8}$/.test(cleaned)) return true
    // International with +: +94XXXXXXXXX
    if (/^\+947[0-9]{8}$/.test(cleaned)) return true
    return false
}

/**
 * Validate email address.
 * Accepts any standard email format.
 */
export function isValidEmail(email: string): boolean {
    if (!email || typeof email !== 'string') return false
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/**
 * Validate a person's name.
 * Must be 2–100 characters, letters/spaces/hyphens/apostrophes allowed.
 */
export function isValidName(name: string): boolean {
    if (!name || typeof name !== 'string') return false
    const trimmed = name.trim()
    return trimmed.length >= 2 && trimmed.length <= 100
}

/**
 * Validate Sri Lankan NIC number.
 * Old format: 9 digits + V/X  e.g. 851234567V
 * New format: 12 digits        e.g. 200012345678
 */
export function isValidNIC(nic: string): boolean {
    if (!nic || typeof nic !== 'string') return false
    const cleaned = nic.trim().toUpperCase()
    if (/^[0-9]{9}[VX]$/.test(cleaned)) return true
    if (/^[0-9]{12}$/.test(cleaned)) return true
    return false
}

/**
 * Build a validation error response body from a list of field errors.
 */
export function validationError(errors: string[]): { error: string; details: string[] } {
    return { error: errors[0], details: errors }
}
