-- AlterTable
ALTER TABLE "Officer" ADD COLUMN     "teleshopManagerId" TEXT;

-- CreateIndex
CREATE INDEX "Officer_teleshopManagerId_idx" ON "Officer"("teleshopManagerId");

-- AddForeignKey
ALTER TABLE "Officer" ADD CONSTRAINT "Officer_teleshopManagerId_fkey" FOREIGN KEY ("teleshopManagerId") REFERENCES "TeleshopManager"("id") ON DELETE SET NULL ON UPDATE CASCADE;
