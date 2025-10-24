// Utility to compute the last daily reset time
// Default reset time is 12:00 PM local server time

export function getLastDailyReset(now: Date = new Date()): Date {
  const resetHour = Number(process.env.DAILY_RESET_HOUR ?? 12)
  const resetMinute = Number(process.env.DAILY_RESET_MINUTE ?? 0)

  const last = new Date(now)
  last.setSeconds(0, 0)
  last.setHours(resetHour, resetMinute, 0, 0)

  // If current time is before today's reset time, use yesterday's reset
  if (now.getTime() < last.getTime()) {
    last.setDate(last.getDate() - 1)
  }
  return last
}

export function getNextDailyReset(now: Date = new Date()): Date {
  const resetHour = Number(process.env.DAILY_RESET_HOUR ?? 12)
  const resetMinute = Number(process.env.DAILY_RESET_MINUTE ?? 0)

  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setHours(resetHour, resetMinute, 0, 0)

  if (now.getTime() >= next.getTime()) {
    next.setDate(next.getDate() + 1)
  }
  return next
}
