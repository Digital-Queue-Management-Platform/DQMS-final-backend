# Database Migration Instructions

## Prerequisites
Before running the migration, ensure you have:
1. A PostgreSQL database running
2. Environment variables configured in `.env`:
   ```env
   DATABASE_URL="postgresql://username:password@host:port/database"
   DIRECT_URL="postgresql://username:password@host:port/database"
   ```

## Running the Migration

### Development Environment
```bash
# Generate and apply migration
npx prisma migrate dev --name add_qr_session_and_device_link

# This will:
# 1. Create migration files in prisma/migrations/
# 2. Apply changes to the database
# 3. Regenerate Prisma Client
```

### Production Environment
```bash
# Apply migrations without prompts
npx prisma migrate deploy

# This will apply all pending migrations
```

## What Gets Created

### New Tables

**QRSession**
```sql
CREATE TABLE "QRSession" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT UNIQUE NOT NULL,
  "qrToken" TEXT UNIQUE NOT NULL,
  "outletId" TEXT NOT NULL,
  "deviceId" TEXT,
  "deviceName" TEXT,
  "status" TEXT DEFAULT 'pending',
  "generatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP NOT NULL,
  "scannedAt" TIMESTAMP,
  "scannedByManagerId" TEXT,
  "linkedAt" TIMESTAMP,
  "linkedManagerId" TEXT,
  "linkedDeviceId" TEXT,
  "unlinkedAt" TIMESTAMP,
  "unlinkedBy" TEXT,
  "unlinkedReason" TEXT,
  "metadata" JSONB,
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
);

-- Indexes
CREATE INDEX "QRSession_sessionId_idx" ON "QRSession"("sessionId");
CREATE INDEX "QRSession_qrToken_idx" ON "QRSession"("qrToken");
CREATE INDEX "QRSession_outletId_status_idx" ON "QRSession"("outletId", "status");
CREATE INDEX "QRSession_status_expiresAt_idx" ON "QRSession"("status", "expiresAt");
CREATE INDEX "QRSession_generatedAt_idx" ON "QRSession"("generatedAt");
CREATE INDEX "QRSession_linkedManagerId_idx" ON "QRSession"("linkedManagerId");
```

**DeviceLink**
```sql
CREATE TABLE "DeviceLink" (
  "id" TEXT PRIMARY KEY,
  "deviceId" TEXT UNIQUE NOT NULL,
  "deviceName" TEXT NOT NULL,
  "macAddress" TEXT,
  "outletId" TEXT NOT NULL,
  "managerId" TEXT NOT NULL,
  "status" TEXT DEFAULT 'active',
  "linkedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP,
  "unlinkedAt" TIMESTAMP,
  "configData" JSONB,
  "metadata" JSONB,
  FOREIGN KEY ("outletId") REFERENCES "Outlet"("id")
);

-- Indexes
CREATE INDEX "DeviceLink_deviceId_idx" ON "DeviceLink"("deviceId");
CREATE INDEX "DeviceLink_outletId_status_idx" ON "DeviceLink"("outletId", "status");
CREATE INDEX "DeviceLink_managerId_idx" ON "DeviceLink"("managerId");
CREATE INDEX "DeviceLink_status_lastSeenAt_idx" ON "DeviceLink"("status", "lastSeenAt");
CREATE INDEX "DeviceLink_lastSeenAt_idx" ON "DeviceLink"("lastSeenAt");
```

### Updated Tables

**Outlet**
- Added relations: `qrSessions` and `deviceLinks`
- No schema changes to existing columns
- **All existing data preserved**

## Verification

After migration, verify the tables were created:

```bash
# Using Prisma Studio
npx prisma studio

# Or using psql
psql $DATABASE_URL -c "\dt"  # List all tables
psql $DATABASE_URL -c "\d QRSession"  # Describe QRSession table
psql $DATABASE_URL -c "\d DeviceLink"  # Describe DeviceLink table
```

## Rollback (if needed)

If you need to rollback the migration:

```bash
# In development
npx prisma migrate reset

# In production - manual rollback
psql $DATABASE_URL << EOF
DROP TABLE IF EXISTS "DeviceLink";
DROP TABLE IF EXISTS "QRSession";
EOF
```

**⚠️ WARNING**: Rollback will delete all QR session and device link data!

## Testing the Migration

After migration, test that the new features work:

```bash
# Start the server
npm run dev

# Test QR generation endpoint
curl -X POST http://localhost:3001/api/outlet/generate-qr-session \
  -H "Content-Type: application/json" \
  -d '{
    "outletId": "your-outlet-id",
    "deviceId": "test-device-123",
    "deviceName": "Test TV"
  }'

# Check if tables have data
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"QRSession\";"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"DeviceLink\";"
```

## Common Issues

### Issue: "Environment variable not found: DIRECT_URL"
**Solution**: Add `DIRECT_URL` to your `.env` file (can be same as DATABASE_URL)

### Issue: "Can't reach database server"
**Solution**: 
1. Check if PostgreSQL is running
2. Verify DATABASE_URL is correct
3. Check network connectivity

### Issue: "Migration failed, database is in an inconsistent state"
**Solution**:
```bash
# Mark migration as resolved
npx prisma migrate resolve --applied add_qr_session_and_device_link

# Or reset and reapply
npx prisma migrate reset
npx prisma migrate dev
```

### Issue: "Prisma Client is not yet ready"
**Solution**:
```bash
# Regenerate Prisma Client
npx prisma generate
```

## Post-Migration Steps

1. **Restart the application**:
   ```bash
   npm run build
   npm start
   ```

2. **Monitor logs** for QR session cleanup jobs:
   ```
   ✅ QR session cleanup jobs started
   🔄 Starting QR session cleanup jobs...
   ```

3. **Test the WebSocket connection**:
   - Connect to ws://localhost:3001?sessionId=test
   - Should see: "WS_CLIENT_CONNECTED" in logs

4. **Verify cleanup jobs are running**:
   - Check logs every 30 seconds for "Expired X old QR session(s)"
   - Check logs every 5 minutes for stale device checks

## Data Migration (if needed)

If you have existing device configurations in `Outlet.displaySettings.linkedDevices`, you can migrate them:

```typescript
// Run this script once after migration
import { prisma } from './src/server'
import { deviceLinkService } from './src/services/deviceLinkService'

async function migrateExistingDevices() {
  const outlets = await prisma.outlet.findMany({
    where: {
      displaySettings: {
        not: null
      }
    }
  })

  for (const outlet of outlets) {
    const settings = outlet.displaySettings as any
    const linkedDevices = settings?.linkedDevices || []

    for (const device of linkedDevices) {
      if (device.deviceId && device.isActive) {
        try {
          await deviceLinkService.createLink({
            deviceId: device.deviceId,
            deviceName: device.deviceName || 'Unknown Device',
            macAddress: device.macAddress,
            outletId: outlet.id,
            managerId: device.configuredBy || 'system',
            metadata: {
              migratedFrom: 'displaySettings',
              originalConfiguredAt: device.configuredAt
            }
          })
          console.log(`✅ Migrated device: ${device.deviceId}`)
        } catch (error) {
          console.error(`❌ Failed to migrate device: ${device.deviceId}`, error)
        }
      }
    }
  }

  console.log('Migration completed!')
}

migrateExistingDevices().then(() => process.exit(0))
```

## Success Indicators

✅ Migration completed successfully when you see:
- No errors during `prisma migrate dev`
- Tables created in database
- Prisma Client regenerated
- Server starts without errors
- QR generation endpoint works
- WebSocket connections established
- Cleanup jobs running in logs

## Support

If you encounter issues:
1. Check server logs for detailed error messages
2. Verify database connection with `npx prisma db pull`
3. Review migration files in `prisma/migrations/`
4. Check Prisma documentation: https://pris.ly/d/migrate
