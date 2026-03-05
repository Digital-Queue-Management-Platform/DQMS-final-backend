-- AlterTable
ALTER TABLE "Service" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 999;

-- CreateIndex
CREATE INDEX "Service_order_idx" ON "Service"("order");
