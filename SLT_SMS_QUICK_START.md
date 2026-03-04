# SLT SMS Integration - Quick Reference

## ✅ What Was Implemented

### 1. **SLT SMS Service** (`src/services/sltSmsService.ts`)
   - Full implementation of SLT SMS Gateway API
   - Automatic mobile number normalization (supports Sri Lankan formats)
   - Multi-language support (English, Sinhala, Tamil)
   - Pre-built message templates for common use cases

### 2. **Unified SMS Helper** (`src/utils/smsHelper.ts`)
   - Supports both SLT SMS and Twilio
   - Automatic fallback mechanism
   - Configurable provider selection

### 3. **API Routes** (`src/routes/slt-sms.routes.ts`)
   - `/api/slt-sms/test` - Send test SMS
   - `/api/slt-sms/send-otp` - Send OTP codes
   - `/api/slt-sms/send-appointment` - Send appointment confirmations
   - `/api/slt-sms/send-token-ready` - Send token notifications
   - `/api/slt-sms/status` - Check configuration status

### 4. **Integrated Workflows**
   - ✅ OTP verification (`/api/customer/otp/start`)
   - ✅ Appointment booking (`/api/appointment/book`)
   - ✅ Bill notifications (`/api/bills/send-notification`)

## 🚀 Quick Start

### 1. Environment Setup
Your `.env` file has been updated with SLT SMS credentials:
```env
SLT_SMS_USERNAME="E00682"
SLT_SMS_PASSWORD="E00682@123"
SLT_SMS_ALIAS="SLTM QMS"
SLT_SMS_API_URL="http://127.0.0.1:9501/api_jsonrpc.php"
SMS_PROVIDER="slt"
```

### 2. Start the Server
```bash
cd backend
npm run dev
```

### 3. Test the Integration
```bash
# Test with default number (0771234567)
npm run test:slt-sms

# Test with your number
npm run test:slt-sms 0712345678
```

### 4. Check Status
```bash
curl http://localhost:3001/api/slt-sms/status
```

### 5. Send Test SMS
```bash
curl -X POST http://localhost:3001/api/slt-sms/test \
  -H "Content-Type: application/json" \
  -d '{
    "to": "0771234567",
    "message": "Test from DQMS"
  }'
```

## 📱 Supported Number Formats

All formats are automatically normalized:
- `0771234567` ✅
- `771234567` ✅
- `+94771234567` ✅
- `94771234567` ✅

## 🌍 Multi-Language Support

Messages are sent in the customer's preferred language:
- **English** (`en`)
- **Sinhala** (`si`)
- **Tamil** (`ta`)

## ⚙️ Provider Selection

Change `SMS_PROVIDER` in `.env`:

| Value | Behavior |
|-------|----------|
| `slt` | Use only SLT SMS |
| `twilio` | Use only Twilio |
| `both` | Try SLT first, fallback to Twilio |

## 📊 Monitoring

### Check Logs
```bash
# Look for these log messages:
[SLT SMS] Sending SMS to 94771234567
[SLT SMS] Message sent successfully to 94771234567
[SMS] Sent via slt to 0771234567
```

### Common Log Patterns
- ✅ `[SMS] Sent via slt` → SLT SMS used successfully
- ✅ `[SMS] Sent via twilio` → Twilio used (fallback or provider choice)
- ❌ `[SLT SMS] Failed to send message` → Check credentials/connectivity

## ⚠️ Important Notes

### Whitelisting Required
As per the credentials image:
> "As informed by Network Management Team, only Mobitel side is pending for whitelisting the SMS Alias."

**Action**: Contact Network Management Team to complete SMS alias whitelisting with Mobitel.

### API URL
The default API URL is `http://127.0.0.1:9501/api_jsonrpc.php`. 

**If this needs to be changed:**
1. Update `SLT_SMS_API_URL` in `.env`
2. Restart the server

### Network Access
Ensure your server can reach the SLT SMS Gateway:
```bash
# Test connectivity
curl -X POST http://127.0.0.1:9501/api_jsonrpc.php \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":"1"}'
```

## 📝 Next Steps

1. ✅ **Test the integration** with your mobile number
2. ✅ **Verify whitelisting** status with Network Management Team
3. ✅ **Update API URL** if different from default
4. ✅ **Deploy to production** with correct credentials
5. ✅ **Monitor logs** for successful SMS delivery

## 📚 Full Documentation

See [SLT_SMS_INTEGRATION_GUIDE.md](./SLT_SMS_INTEGRATION_GUIDE.md) for complete documentation including:
- API endpoint details
- Message templates
- Error handling
- Troubleshooting
- Production deployment

## 🔧 File Changes Summary

### New Files Created
- `src/services/sltSmsService.ts` - SLT SMS API client
- `src/routes/slt-sms.routes.ts` - API endpoints
- `src/utils/smsHelper.ts` - Unified SMS helper
- `scripts/testSltSms.ts` - Test script

### Modified Files
- `src/server.ts` - Added SLT SMS route
- `src/routes/customer.routes.ts` - Updated OTP to use SMS helper
- `src/routes/appointment.routes.ts` - Updated to use SMS helper
- `src/routes/bill.routes.ts` - Updated to use SMS helper
- `.env` - Added SLT SMS credentials
- `.env.example` - Added SLT SMS template
- `package.json` - Added test script

## ✨ Ready to Use!

The SLT SMS integration is now fully integrated into your Queue Management System. All customer-facing SMS notifications (OTP, appointments, bills) will now use your SLT SMS Gateway.

Test it now:
```bash
npm run test:slt-sms 0771234567
```
