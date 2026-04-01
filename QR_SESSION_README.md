# WhatsApp Web-Style QR Code Authentication System

## Overview
This implementation adds WhatsApp Web-style instant QR code authentication for linking outlet TV APK devices with the teleshop manager dashboard. The system provides real-time, bidirectional communication using WebSocket for instant linking and unlinking.

## Features
✅ Dynamic QR code generation with 2-minute expiry
✅ Instant WebSocket-based linking (< 2 seconds)
✅ Real-time status updates (pending → scanned → linked)
✅ Instant unlinking from either manager or device
✅ Automatic cleanup of expired sessions
✅ Rate limiting (10 QR generations per minute per device)
✅ Heartbeat monitoring for connection health
✅ Support for multiple devices per outlet

## Architecture

### Database Models

#### QRSession
Temporary sessions for QR code authentication:
- `sessionId` - Unique session identifier
- `qrToken` - Temporary authentication token (2-minute expiry)
- `status` - pending | scanned | linked | expired | rejected | unlinked
- `outletId`, `deviceId`, `deviceName`
- `linkedManagerId`, `scannedByManagerId`
- Timestamps: generatedAt, expiresAt, scannedAt, linkedAt, unlinkedAt

#### DeviceLink
Persistent device-manager relationships:
- `deviceId` - Unique device identifier
- `deviceName`, `macAddress`
- `outletId`, `managerId`
- `status` - active | inactive | suspended
- `lastSeenAt`, `lastHeartbeatAt`
- `configData`, `metadata` - JSON fields for flexibility

### Services

#### qrSessionService.ts
Manages QR session lifecycle:
- `generateSession()` - Create new QR session with rate limiting
- `validateQRToken()` - Verify token validity and expiry
- `updateSessionStatus()` - Update session state
- `getActiveSession()` - Get current active session for device
- `expireOldSessions()` - Cleanup job for expired sessions
- `cleanupOldSessions()` - Remove very old session records

#### deviceLinkService.ts
Manages persistent device links:
- `createLink()` - Establish device-manager link
- `updateLink()` - Update device information
- `unlinkDevice()` - Soft delete (set inactive)
- `isDeviceLinked()` - Check link status
- `getOutletDevices()` - List devices for outlet
- `updateHeartbeat()` - Update device last-seen timestamp
- `markStaleDevicesInactive()` - Auto-detect dead connections

#### wsManager.ts
WebSocket room management:
- Room-based subscriptions: `qr:session:{id}`, `outlet:{id}:devices`, `manager:{id}:devices`
- Client registration with metadata (deviceId, sessionId, managerId)
- Targeted broadcasts (by device, session, manager, or room)
- Heartbeat tracking and stale connection cleanup
- Connection statistics and monitoring

### API Endpoints

#### Outlet TV APK Endpoints (`/api/outlet`)

**POST /generate-qr-session**
Generate new QR session for device linking.
```json
Request:
{
  "outletId": "uuid",
  "deviceId": "unique-device-id",
  "deviceName": "Samsung TV Living Room"
}

Response:
{
  "success": true,
  "session": {
    "sessionId": "uuid",
    "qrToken": "24-char-token",
    "qrData": "sessionId:qrToken",
    "expiresAt": "2026-04-01T03:10:00Z",
    "expiresIn": 120
  }
}
```

**GET /link-status?deviceId={deviceId}**
Check if device is currently linked.
```json
Response:
{
  "linked": true,
  "status": "active",
  "device": { ... },
  "outlet": { ... },
  "websocketConnected": true
}
```

**DELETE /unlink-device**
Device-initiated logout (APK user clicks "Reset").
```json
Request:
{
  "deviceId": "unique-device-id"
}

Response:
{
  "success": true,
  "message": "Device unlinked successfully"
}
```

**POST /heartbeat**
Device heartbeat to indicate it's alive.
```json
Request:
{
  "deviceId": "unique-device-id"
}

Response:
{
  "success": true,
  "timestamp": "2026-04-01T03:05:00Z"
}
```

**GET /session-status/:sessionId**
Polling fallback for session status (if WebSocket unavailable).

#### Manager Dashboard Endpoints (`/api/teleshop-manager`)

**POST /scan-outlet-qr** (Requires auth)
Manager scans QR code from TV display.
```json
Request:
{
  "qrData": "sessionId:qrToken"
}

Response:
{
  "success": true,
  "session": {
    "sessionId": "uuid",
    "deviceId": "...",
    "deviceName": "Samsung TV Living Room",
    "outlet": { ... }
  },
  "message": "QR code scanned successfully. Please review and approve the device."
}
```

**POST /approve-link** (Requires auth)
Manager approves device after scanning.
```json
Request:
{
  "sessionId": "uuid"
}

Response:
{
  "success": true,
  "message": "Device linked successfully",
  "device": { ... }
}
```

**POST /reject-link** (Requires auth)
Manager rejects device link.
```json
Request:
{
  "sessionId": "uuid",
  "reason": "Wrong device"
}

Response:
{
  "success": true,
  "message": "Device link rejected"
}
```

**DELETE /unlink-device-instant/:deviceId** (Requires auth)
Manager-initiated instant logout.
```json
Response:
{
  "success": true,
  "message": "Device unlinked successfully"
}
```

**GET /linked-devices** (Requires auth)
Get all devices linked to manager's outlet.

### WebSocket Events

#### Outlet TV APK → Server
- `HEARTBEAT` - Keep connection alive
- `QR_SESSION_REGISTER` - Register for session updates
- `DEVICE_HEARTBEAT` - Send status with heartbeat

#### Server → Outlet TV APK
- `QR_GENERATED` - Session created, display QR
- `QR_SCANNED` - Manager scanned, show "connecting..."
- `LINK_ESTABLISHED` - Approved, switch to main UI
- `LINK_REJECTED` - Rejected, regenerate QR
- `SESSION_EXPIRED` - QR expired, regenerate
- `DEVICE_UNLINKED` - Force logout, return to QR screen

#### Manager Dashboard → Server
- `SUBSCRIBE_OUTLET_DEVICES` - Subscribe to updates
- `HEARTBEAT` - Keep connection alive

#### Server → Manager Dashboard
- `DEVICE_LINKED` - New device linked
- `DEVICE_UNLINKED` - Device removed
- `DEVICE_HEARTBEAT` - Device status update

### WebSocket Connection URLs

**Outlet TV APK:**
```
ws://backend:3001?sessionId={sessionId}&deviceId={deviceId}&outletId={outletId}
```

**Manager Dashboard:**
```
ws://backend:3001?managerId={managerId}&outletId={outletId}
```

## Flow Diagrams

### Linking Flow
```
1. APK generates session → POST /generate-qr-session
2. APK connects WebSocket with sessionId
3. APK displays QR code: "sessionId:qrToken"
4. Manager scans QR → POST /scan-outlet-qr
5. Server sends WS: QR_SCANNED to APK (show "connecting...")
6. Manager reviews and clicks Approve → POST /approve-link
7. Server sends WS: LINK_ESTABLISHED to APK
8. APK receives config, switches to main UI
9. Server broadcasts DEVICE_LINKED to outlet devices room
```

### Unlinking Flow (Manager Initiated)
```
1. Manager clicks "Unlink Device" → DELETE /unlink-device-instant/:deviceId
2. Server updates DeviceLink status to 'inactive'
3. Server sends WS: DEVICE_UNLINKED to APK instantly
4. APK receives event, returns to QR screen immediately
5. Server broadcasts DEVICE_UNLINKED to outlet devices room
```

### Unlinking Flow (Device Initiated)
```
1. APK user clicks "Reset Configuration" → DELETE /unlink-device
2. Server updates DeviceLink status to 'inactive'
3. Server sends WS: DEVICE_UNLINKED to Manager (if online)
4. APK returns to QR screen
5. Manager dashboard updates device list
```

## Cleanup Jobs

### Automatic Maintenance
- **Every 30 seconds**: Expire old QR sessions (>2 minutes)
- **Every 5 minutes**: Mark stale devices inactive (no heartbeat for 5 min)
- **Every 6 hours**: Delete expired/rejected sessions (>24 hours old)
- **Every 24 hours**: Delete inactive device links (>30 days)
- **WebSocket**: Disconnect stale connections (no heartbeat for 90 seconds)

## Security Features

1. **Rate Limiting**: Max 10 QR generations per minute per device
2. **Short Expiry**: QR tokens expire in 2 minutes
3. **Single-Use Tokens**: Sessions marked as consumed after scan
4. **Outlet Validation**: QR must match manager's assigned branch
5. **Session Verification**: All WebSocket messages validated
6. **Automatic Cleanup**: Expired sessions purged regularly

## Migration

To apply the database changes:

```bash
# When you have database configured with .env file
npx prisma migrate dev --name add_qr_session_and_device_link

# Or in production
npx prisma migrate deploy
```

This will create the `QRSession` and `DeviceLink` tables without affecting existing data.

## Testing

### Manual Testing Checklist
- [ ] Generate QR on APK
- [ ] Scan QR from manager dashboard
- [ ] Approve link (verify instant connection)
- [ ] Reject link (verify APK shows error)
- [ ] Manager-initiated logout (verify APK returns to QR instantly)
- [ ] APK-initiated logout (verify manager dashboard updates)
- [ ] QR expiry after 2 minutes
- [ ] Rate limiting (try generating 11 QRs quickly)
- [ ] WebSocket reconnection after network interruption
- [ ] Multiple devices per outlet

### Test Script
```bash
# Run the test script
npm run test:qr-setup
```

## Monitoring

### WebSocket Statistics
```javascript
// Get current connection stats
const stats = wsManager.getStats()
// Returns: { totalClients, totalRooms, devices, sessions, managers }
```

### Session Statistics
```javascript
// Get session stats
const stats = await qrSessionService.getSessionStats()
// Returns: { total, pending, scanned, linked, expired, rejected }
```

### Device Link Statistics
```javascript
// Get device link stats
const stats = await deviceLinkService.getLinkStats()
// Returns: { total, active, inactive, suspended }
```

## Troubleshooting

### QR Code Not Working
1. Check session hasn't expired (2-minute limit)
2. Verify outlet ID matches manager's branch
3. Check rate limit hasn't been exceeded
4. Verify WebSocket connection established

### Device Not Linking Instantly
1. Check WebSocket connection on both ends
2. Verify sessionId matches between APK and backend
3. Check network latency
4. Review server logs for errors

### Device Shows as Offline
1. Check device heartbeat is being sent
2. Verify WebSocket connection is active
3. Check if marked inactive by stale device job
4. Review lastSeenAt and lastHeartbeatAt timestamps

## Performance Considerations

- QR sessions stored in database for persistence
- In-memory rate limiting for fast checks
- WebSocket rooms for efficient broadcasting
- Automatic cleanup prevents database bloat
- Indexes on sessionId, qrToken, deviceId for fast lookups

## Future Enhancements

- [ ] Redis integration for distributed WebSocket state
- [ ] Push notifications as WebSocket fallback
- [ ] Multi-region support with geo-routing
- [ ] Device pairing history and analytics
- [ ] QR code refresh without regenerating session
- [ ] Bulk device management operations
- [ ] Device groups and batch unlinking

## Support

For issues or questions, check:
1. Server logs: `systemLogger` entries with module 'qr-session'
2. WebSocket connection status in browser console
3. Database QRSession and DeviceLink tables
4. Network connectivity between APK and backend
