-- AlterTable
-- This migration adds sltTelephoneNumber field to Appointment table
-- The field may already exist from previous deployments, so we use conditional ALTER
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Appointment' 
        AND column_name = 'sltTelephoneNumber'
    ) THEN
        ALTER TABLE "Appointment" ADD COLUMN "sltTelephoneNumber" TEXT;
    END IF;
END $$;
