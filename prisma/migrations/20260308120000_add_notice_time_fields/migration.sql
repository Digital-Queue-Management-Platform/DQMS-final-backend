-- Add time fields to support recurring time-based closure notices
ALTER TABLE "ClosureNotice" ADD COLUMN IF NOT EXISTS "recurringStartTime" TEXT;
ALTER TABLE "ClosureNotice" ADD COLUMN IF NOT EXISTS "recurringEndTime" TEXT;
