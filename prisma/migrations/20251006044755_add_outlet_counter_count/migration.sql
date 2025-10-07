/*
  Warnings:

  - You are about to drop the `Service` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "counterCount" INTEGER DEFAULT 0;

-- DropTable
DROP TABLE "Service";
