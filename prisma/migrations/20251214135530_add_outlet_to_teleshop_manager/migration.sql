/*
  Warnings:

  - A unique constraint covering the columns `[outletId]` on the table `TeleshopManager` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "TeleshopManager" ADD COLUMN     "outletId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TeleshopManager_outletId_key" ON "TeleshopManager"("outletId");

-- CreateIndex
CREATE INDEX "TeleshopManager_outletId_idx" ON "TeleshopManager"("outletId");

-- AddForeignKey
ALTER TABLE "TeleshopManager" ADD CONSTRAINT "TeleshopManager_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
