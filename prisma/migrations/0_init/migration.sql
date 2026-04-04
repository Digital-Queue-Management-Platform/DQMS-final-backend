-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sltMobileNumber" TEXT,
    "nicNumber" TEXT,
    "email" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "tokenNumber" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "preferredLanguages" JSONB,
    "accountRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "outletId" TEXT NOT NULL,
    "assignedTo" TEXT,
    "counterNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "serviceType" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPriority" BOOLEAN NOT NULL DEFAULT false,
    "billPaymentAmount" DOUBLE PRECISION,
    "billPaymentIntent" TEXT,
    "billPaymentMethod" TEXT,
    "isTransferred" BOOLEAN NOT NULL DEFAULT false,
    "sltTelephoneNumber" TEXT,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeleshopManager" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "email" TEXT,
    "branchId" TEXT,

    CONSTRAINT "TeleshopManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Officer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "counterNumber" INTEGER,
    "isTraining" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "assignedServices" JSONB,
    "languages" JSONB,

    CONSTRAINT "Officer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counterCount" INTEGER DEFAULT 0,
    "kioskPassword" TEXT,
    "displaySettings" JSONB,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" TEXT,
    "managerEmail" TEXT,
    "managerMobile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "managerPassword" TEXT,
    "managerLastLoginAt" TIMESTAMP(3),

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedTo" TEXT,
    "assignedToId" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolutionComment" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "relatedEntity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "relatedEntity" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "order" INTEGER NOT NULL DEFAULT 999,
    "isPriorityService" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "booleanValue" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletedService" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "teleshopManagerId" TEXT,
    "customerId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "duration" INTEGER,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletedService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakLog" (
    "id" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "BreakLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLog" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "fromOfficerId" TEXT NOT NULL,
    "fromCounterNumber" INTEGER,
    "toCounterNumber" INTEGER,
    "previousServiceTypes" TEXT[],
    "newServiceTypes" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferLog_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ManagerQRToken" (
    "token" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerQRToken_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "serviceTypes" TEXT[],
    "preferredLanguage" TEXT,
    "appointmentAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "tokenId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sltTelephoneNumber" TEXT,
    "billPaymentAmount" DOUBLE PRECISION,
    "billPaymentIntent" TEXT,
    "billPaymentMethod" TEXT,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCase" (
    "id" TEXT NOT NULL,
    "refNumber" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "officerId" TEXT NOT NULL,
    "teleshopManagerId" TEXT,
    "customerId" TEXT NOT NULL,
    "serviceTypes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCaseUpdate" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorId" TEXT,
    "status" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceCaseUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SltBill" (
    "id" TEXT NOT NULL,
    "telephoneNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountAddress" TEXT,
    "currentBill" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "lastPaymentDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mobileNumber" TEXT,

    CONSTRAINT "SltBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GM" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "GM_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DGM" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "email" TEXT,
    "gmId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "regionIds" TEXT[],

    CONSTRAINT "DGM_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClosureNotice" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringType" TEXT,
    "recurringDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recurringEndDate" TIMESTAMP(3),
    "recurringStartTime" TEXT,
    "recurringEndTime" TEXT,
    "noticeType" TEXT NOT NULL DEFAULT 'closure',

    CONSTRAINT "ClosureNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MercantileHoliday" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MercantileHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OTP" (
    "id" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "otpCode" TEXT NOT NULL,
    "userType" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OTP_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_mobileNumber_idx" ON "Customer"("mobileNumber");

-- CreateIndex
CREATE INDEX "Token_outletId_status_idx" ON "Token"("outletId", "status");

-- CreateIndex
CREATE INDEX "Token_assignedTo_idx" ON "Token"("assignedTo");

-- CreateIndex
CREATE INDEX "Token_outletId_status_createdAt_tokenNumber_idx" ON "Token"("outletId", "status", "createdAt", "tokenNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TeleshopManager_mobileNumber_key" ON "TeleshopManager"("mobileNumber");

-- CreateIndex
CREATE INDEX "TeleshopManager_regionId_idx" ON "TeleshopManager"("regionId");

-- CreateIndex
CREATE INDEX "TeleshopManager_mobileNumber_idx" ON "TeleshopManager"("mobileNumber");

-- CreateIndex
CREATE INDEX "TeleshopManager_branchId_idx" ON "TeleshopManager"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Officer_mobileNumber_key" ON "Officer"("mobileNumber");

-- CreateIndex
CREATE INDEX "Officer_outletId_status_idx" ON "Officer"("outletId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_tokenId_key" ON "Feedback"("tokenId");

-- CreateIndex
CREATE INDEX "Feedback_rating_idx" ON "Feedback"("rating");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "Feedback_assignedTo_assignedToId_idx" ON "Feedback"("assignedTo", "assignedToId");

-- CreateIndex
CREATE INDEX "Document_relatedEntity_idx" ON "Document"("relatedEntity");

-- CreateIndex
CREATE INDEX "Alert_isRead_createdAt_idx" ON "Alert"("isRead", "createdAt");

-- CreateIndex
CREATE INDEX "BackupRestoreHistory_action_createdAt_idx" ON "BackupRestoreHistory"("action", "createdAt");

-- CreateIndex
CREATE INDEX "BackupRestoreHistory_status_createdAt_idx" ON "BackupRestoreHistory"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Service_code_key" ON "Service"("code");

-- CreateIndex
CREATE INDEX "Service_order_idx" ON "Service"("order");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- CreateIndex
CREATE INDEX "CompletedService_teleshopManagerId_completedAt_idx" ON "CompletedService"("teleshopManagerId", "completedAt");

-- CreateIndex
CREATE INDEX "CompletedService_officerId_completedAt_idx" ON "CompletedService"("officerId", "completedAt");

-- CreateIndex
CREATE INDEX "CompletedService_outletId_completedAt_idx" ON "CompletedService"("outletId", "completedAt");

-- CreateIndex
CREATE INDEX "BreakLog_officerId_startedAt_idx" ON "BreakLog"("officerId", "startedAt");

-- CreateIndex
CREATE INDEX "TransferLog_tokenId_idx" ON "TransferLog"("tokenId");

-- CreateIndex
CREATE INDEX "TransferLog_fromOfficerId_createdAt_idx" ON "TransferLog"("fromOfficerId", "createdAt");

-- CreateIndex
CREATE INDEX "TeleshopManagerAuditLog_teleshopManagerId_createdAt_idx" ON "TeleshopManagerAuditLog"("teleshopManagerId", "createdAt");

-- CreateIndex
CREATE INDEX "TeleshopManagerAuditLog_action_createdAt_idx" ON "TeleshopManagerAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ManagerQRToken_outletId_idx" ON "ManagerQRToken"("outletId");

-- CreateIndex
CREATE INDEX "Appointment_outletId_appointmentAt_idx" ON "Appointment"("outletId", "appointmentAt");

-- CreateIndex
CREATE INDEX "Appointment_mobileNumber_appointmentAt_idx" ON "Appointment"("mobileNumber", "appointmentAt");

-- CreateIndex
CREATE INDEX "Appointment_status_appointmentAt_idx" ON "Appointment"("status", "appointmentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCase_refNumber_key" ON "ServiceCase"("refNumber");

-- CreateIndex
CREATE INDEX "ServiceCase_refNumber_idx" ON "ServiceCase"("refNumber");

-- CreateIndex
CREATE INDEX "ServiceCase_outletId_createdAt_idx" ON "ServiceCase"("outletId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceCaseUpdate_caseId_createdAt_idx" ON "ServiceCaseUpdate"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SltBill_telephoneNumber_key" ON "SltBill"("telephoneNumber");

-- CreateIndex
CREATE INDEX "SltBill_telephoneNumber_idx" ON "SltBill"("telephoneNumber");

-- CreateIndex
CREATE INDEX "SltBill_status_dueDate_idx" ON "SltBill"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "GM_mobileNumber_key" ON "GM"("mobileNumber");

-- CreateIndex
CREATE INDEX "GM_mobileNumber_idx" ON "GM"("mobileNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DGM_mobileNumber_key" ON "DGM"("mobileNumber");

-- CreateIndex
CREATE INDEX "DGM_mobileNumber_idx" ON "DGM"("mobileNumber");

-- CreateIndex
CREATE INDEX "DGM_gmId_idx" ON "DGM"("gmId");

-- CreateIndex
CREATE INDEX "ClosureNotice_outletId_endsAt_idx" ON "ClosureNotice"("outletId", "endsAt");

-- CreateIndex
CREATE INDEX "ClosureNotice_isRecurring_recurringType_idx" ON "ClosureNotice"("isRecurring", "recurringType");

-- CreateIndex
CREATE INDEX "MercantileHoliday_date_idx" ON "MercantileHoliday"("date");

-- CreateIndex
CREATE INDEX "OTP_mobileNumber_userType_verified_idx" ON "OTP"("mobileNumber", "userType", "verified");

-- CreateIndex
CREATE INDEX "OTP_expiresAt_idx" ON "OTP"("expiresAt");

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_assignedTo_fkey" FOREIGN KEY ("assignedTo") REFERENCES "Officer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeleshopManager" ADD CONSTRAINT "TeleshopManager_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeleshopManager" ADD CONSTRAINT "TeleshopManager_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Officer" ADD CONSTRAINT "Officer_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "Officer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_teleshopManagerId_fkey" FOREIGN KEY ("teleshopManagerId") REFERENCES "TeleshopManager"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletedService" ADD CONSTRAINT "CompletedService_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakLog" ADD CONSTRAINT "BreakLog_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "Officer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLog" ADD CONSTRAINT "TransferLog_fromOfficerId_fkey" FOREIGN KEY ("fromOfficerId") REFERENCES "Officer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLog" ADD CONSTRAINT "TransferLog_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeleshopManagerAuditLog" ADD CONSTRAINT "TeleshopManagerAuditLog_teleshopManagerId_fkey" FOREIGN KEY ("teleshopManagerId") REFERENCES "TeleshopManager"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerQRToken" ADD CONSTRAINT "ManagerQRToken_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "Officer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCase" ADD CONSTRAINT "ServiceCase_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCaseUpdate" ADD CONSTRAINT "ServiceCaseUpdate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DGM" ADD CONSTRAINT "DGM_gmId_fkey" FOREIGN KEY ("gmId") REFERENCES "GM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosureNotice" ADD CONSTRAINT "ClosureNotice_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

