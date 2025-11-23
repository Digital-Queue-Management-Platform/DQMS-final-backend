-- CreateTable
CREATE TABLE "ServiceCase" (
    "id" TEXT NOT NULL,
    "refNumber" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "teleshopManagerId" TEXT,
    "customerId" TEXT NOT NULL,
    "serviceTypes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCaseUpdate" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorId" TEXT,
    "status" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCaseUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCase_refNumber_key" ON "ServiceCase"("refNumber");

-- CreateIndex
CREATE INDEX "ServiceCase_refNumber_idx" ON "ServiceCase"("refNumber");

-- CreateIndex
CREATE INDEX "ServiceCase_outletId_createdAt_idx" ON "ServiceCase"("outletId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceCaseUpdate_caseId_createdAt_idx" ON "ServiceCaseUpdate"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "Customer_mobileNumber_idx" ON "Customer"("mobileNumber");

-- CreateIndex
CREATE INDEX "Token_outletId_status_createdAt_tokenNumber_idx" ON "Token"("outletId", "status", "createdAt", "tokenNumber");

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "Officer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCaseUpdate" ADD CONSTRAINT "ServiceCaseUpdate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
