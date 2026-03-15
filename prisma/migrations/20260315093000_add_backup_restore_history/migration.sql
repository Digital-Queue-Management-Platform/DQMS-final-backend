-- CreateTable
CREATE TABLE "BackupRestoreHistory" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "filename" TEXT,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "tableCounts" JSONB,
    "errorMessage" TEXT,
    "createdByRole" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRestoreHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRestoreHistory_action_createdAt_idx" ON "BackupRestoreHistory"("action", "createdAt");

-- CreateIndex
CREATE INDEX "BackupRestoreHistory_status_createdAt_idx" ON "BackupRestoreHistory"("status", "createdAt");
