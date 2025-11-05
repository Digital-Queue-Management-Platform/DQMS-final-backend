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

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_outletId_appointmentAt_idx" ON "Appointment"("outletId", "appointmentAt");

-- CreateIndex
CREATE INDEX "Appointment_mobileNumber_appointmentAt_idx" ON "Appointment"("mobileNumber", "appointmentAt");

-- CreateIndex
CREATE INDEX "Appointment_status_appointmentAt_idx" ON "Appointment"("status", "appointmentAt");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
