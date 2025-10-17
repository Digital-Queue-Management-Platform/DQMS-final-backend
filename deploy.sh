#!/bin/bash
# Deploy script for Render

# Install dependencies
npm install

# Run database migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Build the application
npm run build