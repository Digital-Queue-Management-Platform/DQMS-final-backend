-- CreateTable
CREATE TABLE "QRSession" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scannedAt" TIMESTAMP(3),
    "scannedByManagerId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "linkedManagerId" TEXT,
    "linkedDeviceId" TEXT,
    "unlinkedAt" TIMESTAMP(3),
    "unlinkedBy" TEXT,
    "unlinkedReason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "QRSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLink" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "macAddress" TEXT,
    "outletId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMP(3),
    "unlinkedAt" TIMESTAMP(3),
    "configData" JSONB,
    "metadata" JSONB,

    CONSTRAINT "DeviceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QRSession_sessionId_key" ON "QRSession"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "QRSession_qrToken_key" ON "QRSession"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLink_deviceId_key" ON "DeviceLink"("deviceId");

-- CreateIndex
CREATE INDEX "QRSession_sessionId_idx" ON "QRSession"("sessionId");

-- CreateIndex
CREATE INDEX "QRSession_qrToken_idx" ON "QRSession"("qrToken");

-- CreateIndex
CREATE INDEX "QRSession_outletId_status_idx" ON "QRSession"("outletId", "status");

-- CreateIndex
CREATE INDEX "QRSession_status_expiresAt_idx" ON "QRSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "QRSession_generatedAt_idx" ON "QRSession"("generatedAt");

-- CreateIndex
CREATE INDEX "QRSession_linkedManagerId_idx" ON "QRSession"("linkedManagerId");

-- CreateIndex
CREATE INDEX "DeviceLink_deviceId_idx" ON "DeviceLink"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceLink_outletId_status_idx" ON "DeviceLink"("outletId", "status");

-- CreateIndex
CREATE INDEX "DeviceLink_managerId_idx" ON "DeviceLink"("managerId");

-- CreateIndex
CREATE INDEX "DeviceLink_status_lastSeenAt_idx" ON "DeviceLink"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "DeviceLink_lastSeenAt_idx" ON "DeviceLink"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "QRSession" ADD CONSTRAINT "QRSession_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;