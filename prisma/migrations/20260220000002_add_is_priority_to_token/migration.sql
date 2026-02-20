-- AlterTable
-- Add isPriority field for VIP customer handling
-- Uses conditional ALTER to handle existing databases
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Token' 
        AND column_name = 'isPriority'
    ) THEN
        ALTER TABLE "Token" ADD COLUMN "isPriority" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;
