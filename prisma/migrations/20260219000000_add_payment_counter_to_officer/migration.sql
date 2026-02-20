-- AlterTable
-- This migration ensures counterNumber field exists on Officer table
-- The field may already exist from previous migrations, so we use conditional ALTER
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Officer' 
        AND column_name = 'counterNumber'
    ) THEN
        ALTER TABLE "Officer" ADD COLUMN "counterNumber" INTEGER;
    END IF;
END $$;
