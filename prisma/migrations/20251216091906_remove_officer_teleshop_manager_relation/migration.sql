/*
  Warnings:

  - You are about to drop the column `teleshopManagerId` on the `Officer` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Officer" DROP CONSTRAINT "Officer_teleshopManagerId_fkey";

-- DropIndex
DROP INDEX "Officer_teleshopManagerId_idx";

-- AlterTable
ALTER TABLE "Officer" DROP COLUMN "teleshopManagerId";
