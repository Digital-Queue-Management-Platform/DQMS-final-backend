/*
  Warnings:

  - A unique constraint covering the columns `[provinceId]` on the table `DGM` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[regionId]` on the table `GM` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[gmId]` on the table `Region` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `password` to the `GM` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "DGM" ADD COLUMN     "provinceId" TEXT;

-- AlterTable
ALTER TABLE "GM" ADD COLUMN     "password" TEXT NOT NULL,
ADD COLUMN     "regionId" TEXT;

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "provinceId" TEXT;

-- AlterTable
ALTER TABLE "Region" ADD COLUMN     "gmId" TEXT;

-- CreateTable
CREATE TABLE "Province" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Province_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Province_regionId_idx" ON "Province"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "DGM_provinceId_key" ON "DGM"("provinceId");

-- CreateIndex
CREATE UNIQUE INDEX "GM_regionId_key" ON "GM"("regionId");

-- CreateIndex
CREATE INDEX "RTOM_mobileNumber_idx" ON "RTOM"("mobileNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Region_gmId_key" ON "Region"("gmId");

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Province" ADD CONSTRAINT "Province_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GM" ADD CONSTRAINT "GM_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DGM" ADD CONSTRAINT "DGM_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;
