-- AlterTable
ALTER TABLE "TeleshopManager" ADD COLUMN     "branchId" TEXT;

-- CreateIndex
CREATE INDEX "TeleshopManager_branchId_idx" ON "TeleshopManager"("branchId");

-- AddForeignKey
ALTER TABLE "TeleshopManager" ADD CONSTRAINT "TeleshopManager_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
