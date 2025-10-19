# Neon PostgreSQL Setup Guide

## Step 1: Create a Neon Database

1. Go to [https://neon.tech](https://neon.tech)
2. Sign up or log in to your account
3. Click "Create Project"
4. Choose your project name (e.g., "DQMS-Database")
5. Select your preferred region
6. Click "Create Project"

## Step 2: Get Your Connection String

1. In your Neon dashboard, go to the "Connection Details" section
2. Copy the connection string that looks like:
   ```
   postgresql://username:password@ep-xxx-xxx.region.aws.neon.tech/database_name?sslmode=require
   ```

## Step 3: Update Environment Variables

### For Local Development (.env):
```
DATABASE_URL="your-neon-connection-string-here"
```

### For Production (Render Environment Variables):
Set the `DATABASE_URL` environment variable in your Render dashboard to your Neon connection string.

## Step 4: Run Database Migrations

After updating your DATABASE_URL, run these commands:

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Deploy migrations to Neon
npx prisma migrate deploy

# Optional: View your database
npx prisma studio
```

## Step 5: Test the Connection

Run this command to test your database connection:
```bash
npx prisma db pull
```

If successful, your Neon database is properly connected!

## Important Notes

- Neon provides automatic connection pooling
- SSL is required (already included in the connection string)
- Neon has a generous free tier perfect for development
- Your database will auto-pause when not in use (free tier)

## Troubleshooting

If you get connection errors:
1. Check that your DATABASE_URL is correctly formatted
2. Ensure your IP is whitelisted (Neon allows all IPs by default)
3. Verify the database name exists in your Neon project