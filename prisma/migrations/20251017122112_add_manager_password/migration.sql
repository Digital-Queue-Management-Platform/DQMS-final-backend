/*
  Warnings:

  - You are about to drop the column `breakStartedAt` on the `Officer` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Region" ADD COLUMN "managerPassword" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Officer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "counterNumber" INTEGER,
    "isTraining" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME,
    "assignedServices" TEXT,
    CONSTRAINT "Officer_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Officer" ("assignedServices", "counterNumber", "createdAt", "id", "isTraining", "lastLoginAt", "mobileNumber", "name", "outletId", "status") SELECT "assignedServices", "counterNumber", "createdAt", "id", "isTraining", "lastLoginAt", "mobileNumber", "name", "outletId", "status" FROM "Officer";
DROP TABLE "Officer";
ALTER TABLE "new_Officer" RENAME TO "Officer";
CREATE UNIQUE INDEX "Officer_mobileNumber_key" ON "Officer"("mobileNumber");
CREATE INDEX "Officer_outletId_status_idx" ON "Officer"("outletId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
