-- Manual migration to create SltBill table
-- Run this directly on the database if Prisma migrations are having issues

CREATE TABLE IF NOT EXISTS "SltBill" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "telephoneNumber" TEXT NOT NULL UNIQUE,
    "accountName" TEXT NOT NULL,
    "accountAddress" TEXT,
    "currentBill" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "lastPaymentDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "SltBill_telephoneNumber_idx" ON "SltBill"("telephoneNumber");
CREATE INDEX IF NOT EXISTS "SltBill_status_dueDate_idx" ON "SltBill"("status", "dueDate");

-- Insert sample data
INSERT INTO "SltBill" ("id", "telephoneNumber", "accountName", "accountAddress", "currentBill", "dueDate", "status", "createdAt", "updatedAt")
VALUES
    (gen_random_uuid()::text, '0112345678', 'John Silva', '123, Galle Road, Colombo 03', 2500.00, '2026-03-15'::timestamp, 'unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '0117654321', 'Nimal Perera', '456, Kandy Road, Kandy', 3200.50, '2026-03-10'::timestamp, 'unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '0115551234', 'Saman Fernando', '789, Main Street, Negombo', 1850.75, '2026-03-20'::timestamp, 'unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '0118887777', 'Kamala Jayawardena', '321, Lake Road, Matara', 4100.00, '2026-03-05'::timestamp, 'overdue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '0113334444', 'Ruwan Wickramasinghe', '654, Beach Road, Galle', 2890.25, '2026-03-18'::timestamp, 'unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '0116669999', 'Amara De Silva', '987, Temple Road, Anuradhapura', 1500.00, '2026-02-28'::timestamp, 'paid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '0114445555', 'Tharindu Rajapaksha', '147, Hill Street, Nuwara Eliya', 3750.50, '2026-03-12'::timestamp, 'unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '0112223333', 'Dilini Kumari', '258, Station Road, Jaffna', 2100.00, '2026-03-22'::timestamp, 'unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '0119998888', 'Pradeep Mendis', '369, Park Avenue, Ratnapura', 5200.75, '2026-03-08'::timestamp, 'unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '0115557777', 'Sanduni Wijesekara', '741, River View, Kurunegala', 2650.50, '2026-03-25'::timestamp, 'unpaid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("telephoneNumber") DO NOTHING;
