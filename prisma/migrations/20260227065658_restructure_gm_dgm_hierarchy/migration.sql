/*
  Warnings:

  - You are about to drop the column `outletIds` on the `DGM` table. All the data in the column will be lost.
  - You are about to drop the column `regionIds` on the `GM` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DGM" DROP COLUMN "outletIds",
ADD COLUMN     "regionIds" TEXT[];

-- AlterTable
ALTER TABLE "GM" DROP COLUMN "regionIds";
