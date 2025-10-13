/*
  Warnings:

  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_regionId_fkey";

-- AlterTable
ALTER TABLE "Officer" ADD COLUMN     "languages" JSONB;

-- DropTable
DROP TABLE "User";

-- DropEnum
DROP TYPE "Role";
