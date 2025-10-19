# Production Environment Variables for DQMS

## Required Environment Variables for Render/Production

Copy these environment variables to your production deployment (Render dashboard):

### Database Configuration
```
DATABASE_URL=postgresql://neondb_owner:npg_T1K9JDyQxNtw@ep-dry-fog-adfi4e82-pooler.c-2.us-east-1.aws.neon.tech/DQMS?sslmode=require&channel_binding=require
```

### Email Configuration (SMTP)
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=ojithatester@gmail.com
SMTP_PASS=izrn ycvx jyev gkwa
SMTP_FROM=DQMS Admin <ojithatester@gmail.com>
```

### Frontend Origins (CORS)
```
FRONTEND_ORIGIN=http://localhost:3000,http://localhost:5173,https://digital-queue-management-platform.vercel.app
```

### Server Configuration
```
PORT=3001
LONG_WAIT_MINUTES=10
JWT_SECRET=your-production-jwt-secret-here
NODE_ENV=production
```

## How to Set Environment Variables in Render:

1. Go to your Render dashboard
2. Select your backend service
3. Go to "Environment" tab
4. Add each variable above as Name=Value pairs
5. Click "Save Changes"
6. Service will automatically redeploy

## Verification:

After setting the environment variables and deployment completes:

1. ✅ Database migration should apply automatically
2. ✅ Regional manager creation should generate secure passwords
3. ✅ Welcome emails should be sent automatically
4. ✅ No more "Email-only authentication" fallback messages

## Testing:

Try creating a regional manager with these details:
- Region Name: "Test Region"
- Manager Name: "Test Manager"  
- Manager Email: "your-test-email@gmail.com"
- Manager Mobile: "0771234567"

Expected result:
- ✅ 8-character secure password generated
- ✅ Welcome email sent to manager
- ✅ Success message with email confirmation