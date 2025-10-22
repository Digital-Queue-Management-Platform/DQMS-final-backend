-- CreateTable
CREATE TABLE "ManagerQRToken" (
    "token" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerQRToken_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "ManagerQRToken_outletId_idx" ON "ManagerQRToken"("outletId");

-- AddForeignKey
ALTER TABLE "ManagerQRToken" ADD CONSTRAINT "ManagerQRToken_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
