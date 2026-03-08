-- Add recurring support to ClosureNotice table
ALTER TABLE "ClosureNotice" ADD COLUMN IF NOT EXISTS "isRecurring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClosureNotice" ADD COLUMN IF NOT EXISTS "recurringType" TEXT;
ALTER TABLE "ClosureNotice" ADD COLUMN IF NOT EXISTS "recurringDays" TEXT[] DEFAULT '{}';
ALTER TABLE "ClosureNotice" ADD COLUMN IF NOT EXISTS "recurringEndDate" TIMESTAMP(3);

-- Create index for efficient recurring notice queries
CREATE INDEX IF NOT EXISTS "ClosureNotice_isRecurring_recurringType_idx" ON "ClosureNotice"("isRecurring", "recurringType");