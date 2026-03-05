-- CreateTable TransferLog
CREATE TABLE "TransferLog" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "fromOfficerId" TEXT NOT NULL,
    "fromCounterNumber" INTEGER,
    "toCounterNumber" INTEGER,
    "previousServiceTypes" TEXT[],
    "newServiceTypes" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransferLog_tokenId_idx" ON "TransferLog"("tokenId");

-- CreateIndex
CREATE INDEX "TransferLog_fromOfficerId_createdAt_idx" ON "TransferLog"("fromOfficerId", "createdAt");

-- AddForeignKey
ALTER TABLE "TransferLog" ADD CONSTRAINT "TransferLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLog" ADD CONSTRAINT "TransferLog_fromOfficerId_fkey" FOREIGN KEY ("fromOfficerId") REFERENCES "Officer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
