-- Add noticeType column to ClosureNotice table
-- "closure" = blocks customers (non-dismissable)
-- "standard" = informational, customer can dismiss and continue
ALTER TABLE "ClosureNotice" ADD COLUMN IF NOT EXISTS "noticeType" TEXT NOT NULL DEFAULT 'closure';

-- Create index for efficient notice type queries
CREATE INDEX IF NOT EXISTS "ClosureNotice_noticeType_idx" ON "ClosureNotice"("noticeType");
