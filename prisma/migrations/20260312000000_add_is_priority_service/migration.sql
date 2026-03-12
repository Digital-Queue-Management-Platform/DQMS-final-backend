-- AlterTable: Add isPriorityService flag to Service model
ALTER TABLE "Service" ADD COLUMN "isPriorityService" BOOLEAN NOT NULL DEFAULT false;
