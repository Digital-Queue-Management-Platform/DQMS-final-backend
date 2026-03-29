-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "module" TEXT,
    "event" TEXT,
    "message" TEXT NOT NULL,
    "stackTrace" TEXT,
    "metadata" JSONB,
    "userId" TEXT,
    "userRole" TEXT,
    "outletId" TEXT,
    "regionId" TEXT,
    "deviceId" TEXT,
    "sessionId" TEXT,
    "requestId" TEXT,
    "appVersion" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceHeartbeat" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'online',
    "appVersion" TEXT,
    "websocketConnected" BOOLEAN NOT NULL DEFAULT false,
    "pollingMode" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "service" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "branch" TEXT,
    "commitHash" TEXT,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "duration" INTEGER,
    "output" TEXT,
    "errorMessage" TEXT,
    "notes" TEXT,

    CONSTRAINT "DeploymentLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "outletId" TEXT,
    "regionId" TEXT,
    "changes" JSONB,
    "metadata" JSONB,
    "message" TEXT NOT NULL,
    "ipAddress" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemLog_timestamp_idx" ON "SystemLog"("timestamp");

-- CreateIndex
CREATE INDEX "SystemLog_level_timestamp_idx" ON "SystemLog"("level", "timestamp");

-- CreateIndex
CREATE INDEX "SystemLog_service_timestamp_idx" ON "SystemLog"("service", "timestamp");

-- CreateIndex
CREATE INDEX "SystemLog_outletId_timestamp_idx" ON "SystemLog"("outletId", "timestamp");

-- CreateIndex
CREATE INDEX "SystemLog_userId_timestamp_idx" ON "SystemLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "SystemLog_event_timestamp_idx" ON "SystemLog"("event", "timestamp");

-- CreateIndex
CREATE INDEX "SystemLog_level_service_timestamp_idx" ON "SystemLog"("level", "service", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceHeartbeat_deviceId_key" ON "DeviceHeartbeat"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceHeartbeat_outletId_status_idx" ON "DeviceHeartbeat"("outletId", "status");

-- CreateIndex
CREATE INDEX "DeviceHeartbeat_deviceType_status_idx" ON "DeviceHeartbeat"("deviceType", "status");

-- CreateIndex
CREATE INDEX "DeviceHeartbeat_lastSeenAt_idx" ON "DeviceHeartbeat"("lastSeenAt");

-- CreateIndex
CREATE INDEX "DeviceHeartbeat_status_lastSeenAt_idx" ON "DeviceHeartbeat"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "DeploymentLog_timestamp_idx" ON "DeploymentLog"("timestamp");

-- CreateIndex
CREATE INDEX "DeploymentLog_service_timestamp_idx" ON "DeploymentLog"("service", "timestamp");

-- CreateIndex
CREATE INDEX "DeploymentLog_status_timestamp_idx" ON "DeploymentLog"("status", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_userId_timestamp_idx" ON "AuditLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_action_timestamp_idx" ON "AuditLog"("action", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_outletId_timestamp_idx" ON "AuditLog"("outletId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_userRole_timestamp_idx" ON "AuditLog"("userRole", "timestamp");

-- AddForeignKey
ALTER TABLE "SystemLog" ADD CONSTRAINT "SystemLog_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemLog" ADD CONSTRAINT "SystemLog_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceHeartbeat" ADD CONSTRAINT "DeviceHeartbeat_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;
