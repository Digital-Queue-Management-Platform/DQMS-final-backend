-- CreateTable: AppSetting
CREATE TABLE "AppSetting" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "booleanValue" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

INSERT INTO "AppSetting" ("id", "key", "booleanValue", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'priority_service_enabled', true, now(), now());
