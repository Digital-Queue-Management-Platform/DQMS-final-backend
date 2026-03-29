-- CreateTable
CREATE TABLE "TokenBill" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "telephoneNumber" TEXT NOT NULL,
    "billPaymentIntent" TEXT,
    "billPaymentAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentBill" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "telephoneNumber" TEXT NOT NULL,
    "billPaymentIntent" TEXT,
    "billPaymentAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenBill_tokenId_idx" ON "TokenBill"("tokenId");

-- CreateIndex
CREATE INDEX "TokenBill_telephoneNumber_idx" ON "TokenBill"("telephoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TokenBill_tokenId_telephoneNumber_key" ON "TokenBill"("tokenId", "telephoneNumber");

-- CreateIndex
CREATE INDEX "AppointmentBill_appointmentId_idx" ON "AppointmentBill"("appointmentId");

-- CreateIndex
CREATE INDEX "AppointmentBill_telephoneNumber_idx" ON "AppointmentBill"("telephoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentBill_appointmentId_telephoneNumber_key" ON "AppointmentBill"("appointmentId", "telephoneNumber");

-- AddForeignKey
ALTER TABLE "TokenBill" ADD CONSTRAINT "TokenBill_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenBill" ADD CONSTRAINT "TokenBill_telephoneNumber_fkey" FOREIGN KEY ("telephoneNumber") REFERENCES "SltBill"("telephoneNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentBill" ADD CONSTRAINT "AppointmentBill_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentBill" ADD CONSTRAINT "AppointmentBill_telephoneNumber_fkey" FOREIGN KEY ("telephoneNumber") REFERENCES "SltBill"("telephoneNumber") ON DELETE RESTRICT ON UPDATE CASCADE;
