-- AlterTable
ALTER TABLE "Officer" ADD COLUMN     "teleshopManagerId" TEXT;

-- CreateTable
CREATE TABLE "TeleshopManager" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "TeleshopManager_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeleshopManager_mobileNumber_key" ON "TeleshopManager"("mobileNumber");

-- CreateIndex
CREATE INDEX "TeleshopManager_regionId_idx" ON "TeleshopManager"("regionId");

-- CreateIndex
CREATE INDEX "TeleshopManager_mobileNumber_idx" ON "TeleshopManager"("mobileNumber");

-- CreateIndex
CREATE INDEX "Officer_teleshopManagerId_idx" ON "Officer"("teleshopManagerId");

-- AddForeignKey
ALTER TABLE "TeleshopManager" ADD CONSTRAINT "TeleshopManager_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Officer" ADD CONSTRAINT "Officer_teleshopManagerId_fkey" FOREIGN KEY ("teleshopManagerId") REFERENCES "TeleshopManager"("id") ON DELETE SET NULL ON UPDATE CASCADE;
