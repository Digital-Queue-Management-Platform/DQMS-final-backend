# SLT SMS Integration Guide

## Overview

The Digital Queue Management Platform (DQMP) now supports SMS notifications via the **SLT SMS Gateway**. This integration allows you to send SMS notifications to customers in Sri Lanka using your SLT SMS account.

## Features

- ✅ **OTP Verification**: Send one-time passwords for phone number verification
- ✅ **Appointment Confirmations**: Notify customers about their scheduled appointments
- ✅ **Token Notifications**: Alert customers when it's their turn
- ✅ **Bill Notifications**: Send SLT bill payment reminders
- ✅ **Multi-language Support**: English, Sinhala, and Tamil
- ✅ **Fallback Support**: Use Twilio as fallback if SLT SMS fails
- ✅ **Automatic Number Normalization**: Supports multiple Sri Lankan mobile number formats

## Prerequisites

### SLT SMS Credentials

You need the following credentials from SLT:

- **SMS Alias**: Your sender ID (e.g., `SLTM QMS`)
- **Username**: Your SLT SMS account username (e.g., `E00682`)
- **Password**: Your SLT SMS account password (e.g., `E00682@123`)
- **API URL**: SLT SMS Gateway endpoint (default: `http://127.0.0.1:9501/api_jsonrpc.php`)

**From the provided image:**
```
SMS Alias: SLTM QMS
Username: E00682
Password: E00682@123
```

> **Note**: As informed by the Network Management Team, only the Mobitel side is pending for whitelisting the SMS Alias.

## Configuration

### Environment Variables

Add the following variables to your `.env` file:

```env
# SLT SMS Configuration
SLT_SMS_USERNAME=E00682
SLT_SMS_PASSWORD=E00682@123
SLT_SMS_ALIAS=SLTM QMS
SLT_SMS_API_URL=http://127.0.0.1:9501/api_jsonrpc.php

# SMS Provider Selection
# Options: 'slt', 'twilio', or 'both' (both means try SLT first, fallback to Twilio)
SMS_PROVIDER=slt
```

### Provider Options

| Provider | Description |
|----------|-------------|
| `slt` | Use only SLT SMS Gateway |
| `twilio` | Use only Twilio (existing setup) |
| `both` | Try SLT first, fallback to Twilio if SLT fails |

## Mobile Number Formats

The system automatically handles multiple Sri Lankan mobile number formats:

- `0771234567` → Normalized to `94771234567`
- `771234567` → Normalized to `94771234567`
- `+94771234567` → Normalized to `94771234567`
- `94771234567` → Already in correct format

## API Endpoints

### 1. Test SMS

Send a test SMS to verify configuration.

**Endpoint:** `POST /api/slt-sms/test`

**Request Body:**
```json
{
  "to": "0771234567",
  "message": "This is a test message from DQMS"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "unique-message-id",
  "to": "0771234567",
  "message": "This is a test message from DQMS"
}
```

### 2. Send OTP

Send an OTP code to a mobile number.

**Endpoint:** `POST /api/slt-sms/send-otp`

**Request Body:**
```json
{
  "to": "0771234567",
  "otpCode": "1234",
  "language": "en"
}
```

**Languages:** `en`, `si`, `ta`

**Response:**
```json
{
  "success": true,
  "messageId": "unique-message-id"
}
```

### 3. Send Appointment Confirmation

**Endpoint:** `POST /api/slt-sms/send-appointment`

**Request Body:**
```json
{
  "to": "0771234567",
  "appointmentDetails": {
    "name": "John Doe",
    "outletName": "Colombo Branch",
    "dateTime": "2026-03-05 10:00 AM",
    "services": "Bill Payment, New Connection"
  },
  "language": "en"
}
```

### 4. Send Token Ready Notification

**Endpoint:** `POST /api/slt-sms/send-token-ready`

**Request Body:**
```json
{
  "to": "0771234567",
  "tokenNumber": 42,
  "counterNumber": 5,
  "language": "en"
}
```

### 5. Check Service Status

Check if SLT SMS is properly configured.

**Endpoint:** `GET /api/slt-sms/status`

**Response:**
```json
{
  "configured": true,
  "service": "SLT SMS Gateway",
  "status": "ready"
}
```

## Integration Points

The SLT SMS service is automatically integrated into the following workflows:

### 1. OTP Verification (`/api/customer/otp/start`)

When customers request an OTP:
```typescript
// Automatically uses configured SMS provider (SLT or Twilio)
POST /api/customer/otp/start
{
  "mobileNumber": "0771234567",
  "preferredLanguage": "en"
}
```

### 2. Appointment Booking (`/api/appointment/book`)

After booking an appointment:
```typescript
// Sends confirmation SMS in customer's preferred language
POST /api/appointment/book
{
  "name": "John Doe",
  "mobileNumber": "0771234567",
  "preferredLanguage": "si",
  // ... other fields
}
```

### 3. Bill Notifications (`/api/bills/send-notification`)

Send SLT bill payment reminders:
```typescript
POST /api/bills/send-notification
{
  "mobileNumber": "0771234567",
  "accountName": "John Doe",
  "billAmount": "1500.00",
  "dueDate": "2026-03-15",
  "sltNumber": "0112345678"
}
```

## Message Templates

### English (en)
- **OTP**: "Your DQMS verification code is {code}. It expires in 5 minutes."
- **Appointment**: "Dear {name}, your appointment at {outlet} is confirmed for {dateTime}. Services: {services}. -DQMS"
- **Token Ready**: "Token #{tokenNumber}: Please proceed to Counter {counterNumber}. -DQMS"

### Sinhala (si)
- **OTP**: "ඔබගේ DQMS සත්‍යාපන කේතය {code}. මිනිත්තු 5කින් කල් ඉකුත් වේ."
- **Appointment**: "{name}, {outlet} හි ඔබගේ හමුව {dateTime} සඳහා තහවුරු කර ඇත. සේවාවන්: {services}. -DQMS"
- **Token Ready**: "ටෝකන් #{tokenNumber}: කරුණාකර කවුන්ටර් {counterNumber} වෙත යන්න. -DQMS"

### Tamil (ta)
- **OTP**: "உங்கள் DQMS சரிபார்ப்பு குறியீடு {code}. இது 5 நிமிடங்களில் காலாவதியாகிறது."
- **Appointment**: "{name}, {outlet} இல் உங்கள் சந்திப்பு {dateTime} அன்று உறுதிப்படுத்தப்பட்டது. சேவைகள்: {services}. -DQMS"
- **Token Ready**: "டோக்கன் #{tokenNumber}: கவுண்டர் {counterNumber} க்கு செல்லவும். -DQMS"

## Testing

### Using cURL

#### Test Basic SMS
```bash
curl -X POST http://localhost:3001/api/slt-sms/test \
  -H "Content-Type: application/json" \
  -d '{
    "to": "0771234567",
    "message": "Test message from DQMS"
  }'
```

#### Test OTP
```bash
curl -X POST http://localhost:3001/api/slt-sms/send-otp \
  -H "Content-Type: application/json" \
  -d '{
    "to": "0771234567",
    "otpCode": "1234",
    "language": "en"
  }'
```

#### Check Status
```bash
curl http://localhost:3001/api/slt-sms/status
```

### Development Mode

Enable development mode to skip actual SMS sending (useful for testing):

```env
OTP_DEV_MODE=true
OTP_DEV_ECHO=true
```

In dev mode:
- SMS messages are logged to console
- No actual SMS is sent
- OTP codes are returned in API response

## Error Handling

The system handles errors gracefully:

1. **Invalid Mobile Number**: Returns error if number format is invalid
2. **Missing Credentials**: Returns 503 if SLT SMS is not configured
3. **API Failures**: Logs error and returns appropriate HTTP status
4. **Fallback**: If `SMS_PROVIDER=both`, automatically tries Twilio if SLT fails

### Example Error Response
```json
{
  "error": "SLT SMS service is not configured",
  "details": "Please set SLT_SMS_USERNAME, SLT_SMS_PASSWORD, and SLT_SMS_ALIAS in environment variables"
}
```

## Troubleshooting

### SMS Not Sending

1. **Check Configuration**
   ```bash
   curl http://localhost:3001/api/slt-sms/status
   ```

2. **Verify Credentials**
   - Ensure `SLT_SMS_USERNAME`, `SLT_SMS_PASSWORD`, and `SLT_SMS_ALIAS` are set correctly
   - Check that the API URL is accessible from your server

3. **Check Logs**
   ```bash
   # Look for SMS-related logs
   [SLT SMS] Sending SMS to 94771234567
   [SLT SMS] Message sent successfully to 94771234567
   ```

4. **Test with Simple Message**
   ```bash
   curl -X POST http://localhost:3001/api/slt-sms/test \
     -H "Content-Type: application/json" \
     -d '{"to": "0771234567", "message": "Test"}'
   ```

### Whitelisting Required

As noted in the credentials image:
> "As informed by Network Management Team, only Mobitel side is pending for whitelisting the SMS Alias."

**Action Required**: Contact the Network Management Team to complete whitelisting of your SMS Alias (`SLTM QMS`) with Mobitel.

## Production Deployment

### Update Environment Variables

On your production server (e.g., Render, Railway):

1. Go to your service's environment variables
2. Add SLT SMS credentials:
   ```
   SLT_SMS_USERNAME=E00682
   SLT_SMS_PASSWORD=E00682@123
   SLT_SMS_ALIAS=SLTM QMS
   SLT_SMS_API_URL=http://127.0.0.1:9501/api_jsonrpc.php
   SMS_PROVIDER=slt
   ```
3. Redeploy your application

### Network Configuration

Ensure your production server can reach the SLT SMS Gateway API:
- Check firewall rules
- Verify VPN/network access if SLT API is on private network
- Test connectivity: `curl http://127.0.0.1:9501/api_jsonrpc.php`

## Code Structure

```
backend/
├── src/
│   ├── services/
│   │   └── sltSmsService.ts       # SLT SMS API client
│   ├── routes/
│   │   └── slt-sms.routes.ts      # SLT SMS API endpoints
│   ├── utils/
│   │   └── smsHelper.ts           # Unified SMS helper (SLT + Twilio)
│   └── server.ts                  # Route registration
```

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs for error messages
3. Test SMS sending with the test endpoint
4. Verify SLT SMS credentials and network connectivity

## License

Part of the Digital Queue Management Platform (DQMP)
