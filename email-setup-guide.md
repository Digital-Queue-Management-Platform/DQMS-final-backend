# Email Setup Guide for DQMS

## Gmail SMTP Setup (Recommended)

### Step 1: Enable 2-Factor Authentication
1. Go to your Google Account settings
2. Enable 2-Factor Authentication if not already enabled

### Step 2: Generate App-Specific Password
1. Go to Google Account > Security > 2-Step Verification
2. Scroll down to "App passwords"
3. Select "Mail" and your device
4. Google will generate a 16-character password

### Step 3: Configure Environment Variables
Update your `.env` file with:

```env
# Email Configuration
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"  
SMTP_SECURE="false"
SMTP_USER="your-gmail@gmail.com"
SMTP_PASS="your-16-character-app-password"
SMTP_FROM="DQMS Admin <your-gmail@gmail.com>"
```

## Other Email Providers

### Outlook/Hotmail
```env
SMTP_HOST="smtp-mail.outlook.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-email@outlook.com"
SMTP_PASS="your-password"
```

### Custom SMTP Server
```env
SMTP_HOST="your-smtp-server.com"
SMTP_PORT="587"
SMTP_SECURE="false"  # Set to "true" for port 465
SMTP_USER="your-username"
SMTP_PASS="your-password"
```

## Production Environment Variables

For production deployment (Render, Heroku, etc.), set these environment variables:

- `SMTP_HOST`
- `SMTP_PORT` 
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

## Testing Email Functionality

Run this script to test your email configuration:

```bash
npm run test:email
```

## Email Features

When an admin creates a new regional manager:

✅ **Secure Password Generation**: 8-character password with uppercase, lowercase, numbers, and symbols
✅ **Professional Email Template**: HTML and text versions
✅ **Security Instructions**: Prompts manager to change password immediately
✅ **Direct Login Link**: Includes link to manager portal
✅ **Comprehensive Information**: Lists responsibilities and next steps

## Troubleshooting

### Common Issues:

1. **Authentication Failed**
   - Double-check app-specific password
   - Ensure 2FA is enabled
   - Verify email/password combination

2. **Connection Timeout**
   - Check SMTP host and port
   - Verify network connectivity
   - Try different SMTP server

3. **Email Not Received**
   - Check spam/junk folder
   - Verify recipient email address
   - Check email service logs

### Debug Mode:
Set `NODE_ENV=development` to see detailed email logs in console.

## Security Best Practices

- Use app-specific passwords, never regular account passwords
- Store credentials in environment variables, not in code
- Use SMTP over TLS (port 587) instead of SSL (port 465)
- Regularly rotate email passwords
- Monitor email sending logs for suspicious activity