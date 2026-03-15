-- AlterTable: Add isPriorityService flag to Service model
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "isPriorityService" BOOLEAN NOT NULL DEFAULT false;
