import { PrismaClient } from '@prisma/client'

type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"> | PrismaClient

/**
 * Calculates the next available token number for a given set of services,
 * respecting admin-configured starting numbers (e.g. 1000, 2000).
 */
export async function getNextTokenNumber(
  tx: TxClient, 
  outletId: string, 
  serviceTypes: string[], 
  lastReset: Date
): Promise<number> {
  // 1. Fetch configured starting numbers
  let startingTokens: Record<string, number> = {}
  try {
    const rows = await tx.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "SystemSetting" WHERE "key" = 'service_starting_tokens' LIMIT 1
    `
    if (rows && rows.length > 0 && rows[0].value) {
      startingTokens = JSON.parse(rows[0].value)
    }
  } catch (e) {
    // If the table doesn't exist or JSON parsing fails, we fallback to empty
    console.error("Failed to fetch/parse service_starting_tokens", e)
  }

  // 2. Determine primary service
  const primaryServiceCode = Array.isArray(serviceTypes) && serviceTypes.length > 0 ? serviceTypes[0] : null
  
  // 3. Determine range based on primary service
  let startNumber = 1
  if (primaryServiceCode && startingTokens[primaryServiceCode]) {
    // Force it to a valid integer
    startNumber = parseInt(startingTokens[primaryServiceCode] as any, 10) || 1
  }

  // Assume standard 1000-block ranges to prevent token numbers from different ranges from overlapping
  let endNumber = startNumber >= 1000 ? startNumber + 999 : 999

  // 4. Find max token number within this block for the day
  const lastToken = await (tx as any).token.findFirst({
    where: {
      outletId,
      createdAt: { gte: lastReset },
      tokenNumber: {
        gte: startNumber,
        lte: endNumber
      }
    },
    orderBy: { tokenNumber: 'desc' },
    select: { tokenNumber: true }
  })

  const nextNumber = lastToken ? lastToken.tokenNumber + 1 : startNumber
  
  // Failsafe: If for some reason we exhausted the block (e.g. 1000 tickets in a day), 
  // we could just let it roll over. But keeping it simple for now.
  return nextNumber
}
