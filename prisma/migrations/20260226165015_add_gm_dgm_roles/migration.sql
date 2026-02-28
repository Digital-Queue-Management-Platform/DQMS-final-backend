-- CreateTable
CREATE TABLE "GM" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobileNumber" TEXT NOT NULL,
    "email" TEXT,
    "regionIds" TEXT[],
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
    "outletIds" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "DGM_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "DGM" ADD CONSTRAINT "DGM_gmId_fkey" FOREIGN KEY ("gmId") REFERENCES "GM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
