-- DropIndex
DROP INDEX "ClosureNotice_noticeType_idx";

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "outletId" TEXT;

-- AlterTable
ALTER TABLE "AppSetting" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "billPaymentAmount" DOUBLE PRECISION,
ADD COLUMN     "billPaymentIntent" TEXT,
ADD COLUMN     "billPaymentMethod" TEXT,
ADD COLUMN     "reminder1hSentAt" TIMESTAMP(3),
ADD COLUMN     "reminder30mSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Officer" ADD COLUMN     "email" TEXT;

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "displaySettings" JSONB;

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "billPaymentAmount" DOUBLE PRECISION,
ADD COLUMN     "billPaymentIntent" TEXT,
ADD COLUMN     "billPaymentMethod" TEXT,
ADD COLUMN     "isTransferred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sltTelephoneNumber" TEXT;

-- CreateIndex
CREATE INDEX "Alert_outletId_idx" ON "Alert"("outletId");
