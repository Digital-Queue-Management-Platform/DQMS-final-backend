-- CreateTable
CREATE TABLE "TeleshopManagerAuditLog" (
    "id" TEXT NOT NULL,
    "teleshopManagerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeleshopManagerAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeleshopManagerAuditLog_teleshopManagerId_createdAt_idx" ON "TeleshopManagerAuditLog"("teleshopManagerId", "createdAt");

-- CreateIndex
CREATE INDEX "TeleshopManagerAuditLog_action_createdAt_idx" ON "TeleshopManagerAuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "TeleshopManagerAuditLog" ADD CONSTRAINT "TeleshopManagerAuditLog_teleshopManagerId_fkey" FOREIGN KEY ("teleshopManagerId") REFERENCES "TeleshopManager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
