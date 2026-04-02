-- CreateTable
CREATE TABLE "RTOM" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "email" TEXT,
    "dgmId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "RTOM_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RTOM_mobileNumber_key" ON "RTOM"("mobileNumber");

-- CreateIndex
CREATE INDEX "RTOM_dgmId_idx" ON "RTOM"("dgmId");

-- CreateIndex
CREATE INDEX "RTOM_regionId_idx" ON "RTOM"("regionId");

-- AddForeignKey
ALTER TABLE "RTOM" ADD CONSTRAINT "RTOM_dgmId_fkey" FOREIGN KEY ("dgmId") REFERENCES "DGM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RTOM" ADD CONSTRAINT "RTOM_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add rtomId to TeleshopManager table
ALTER TABLE "TeleshopManager" ADD COLUMN "rtomId" TEXT;

-- Create index for rtomId
CREATE INDEX "TeleshopManager_rtomId_idx" ON "TeleshopManager"("rtomId");

-- AddForeignKey for TeleshopManager to RTOM
ALTER TABLE "TeleshopManager" ADD CONSTRAINT "TeleshopManager_rtomId_fkey" FOREIGN KEY ("rtomId") REFERENCES "RTOM"("id") ON DELETE SET NULL ON UPDATE CASCADE;