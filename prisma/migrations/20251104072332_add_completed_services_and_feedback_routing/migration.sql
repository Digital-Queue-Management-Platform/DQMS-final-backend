-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "assignedTo" TEXT,
ADD COLUMN     "assignedToId" TEXT,
ADD COLUMN     "isResolved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolutionComment" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedBy" TEXT;

-- CreateTable
CREATE TABLE "CompletedService" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "teleshopManagerId" TEXT,
    "customerId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "duration" INTEGER,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletedService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompletedService_teleshopManagerId_completedAt_idx" ON "CompletedService"("teleshopManagerId", "completedAt");

-- CreateIndex
CREATE INDEX "CompletedService_officerId_completedAt_idx" ON "CompletedService"("officerId", "completedAt");

-- CreateIndex
CREATE INDEX "CompletedService_outletId_completedAt_idx" ON "CompletedService"("outletId", "completedAt");

-- CreateIndex
CREATE INDEX "Feedback_assignedTo_assignedToId_idx" ON "Feedback"("assignedTo", "assignedToId");

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "Officer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_teleshopManagerId_fkey" FOREIGN KEY ("teleshopManagerId") REFERENCES "TeleshopManager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
