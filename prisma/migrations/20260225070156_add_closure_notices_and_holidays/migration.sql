/*
  Warnings:

  - You are about to drop the `BranchClosure` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BranchClosure" DROP CONSTRAINT "BranchClosure_outletId_fkey";

-- AlterTable
ALTER TABLE "MercantileHoliday" ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "BranchClosure";

-- CreateTable
CREATE TABLE "ClosureNotice" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClosureNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClosureNotice_outletId_endsAt_idx" ON "ClosureNotice"("outletId", "endsAt");

-- AddForeignKey
ALTER TABLE "ClosureNotice" ADD CONSTRAINT "ClosureNotice_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
