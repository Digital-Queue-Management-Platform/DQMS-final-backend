#!/bin/bash

# DQMP Backend Quick Deploy Script
# This script helps you quickly deploy the backend using Docker

set -e

echo "🚀 DQMP Backend Deployment Script"
echo "=================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "Creating .env from .env.example..."
    
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ .env file created. Please edit it with your configuration."
        echo ""
        echo "⚠️  IMPORTANT: Update the following in .env:"
        echo "   - DATABASE_URL"
        echo "   - JWT_SECRET (use a strong random string)"
        echo "   - EMAIL_* settings"
        echo "   - FRONTEND_ORIGIN"
        echo ""
        read -p "Press Enter to continue after updating .env file..."
    else
        echo "❌ .env.example not found. Please create .env file manually."
        exit 1
    fi
fi

echo "✅ .env file found"
echo ""

# Ask deployment type
echo "Select deployment type:"
echo "1) Development (with PostgreSQL in Docker)"
echo "2) Production (requires external database)"
read -p "Enter choice (1 or 2): " deploy_type

if [ "$deploy_type" == "1" ]; then
    echo ""
    echo "🔨 Building and starting services (Development)..."
    docker compose up -d --build
    
    echo ""
    echo "⏳ Waiting for database to be ready..."
    sleep 10
    
    echo "🔄 Running database migrations..."
    docker compose exec backend npx prisma migrate deploy || true
    
elif [ "$deploy_type" == "2" ]; then
    echo ""
    echo "🔨 Building backend only (Production)..."
    docker compose up -d --build backend
    
    echo ""
    echo "⏳ Waiting for backend to start..."
    sleep 10
    
    echo "🔄 Running database migrations..."
    docker compose exec backend npx prisma migrate deploy || true
else
    echo "❌ Invalid choice"
    exit 1
fi

echo ""
echo "✅ Deployment completed!"
echo ""
echo "📊 Service Status:"
docker compose ps

echo ""
echo "🌐 Services:"
echo "   - Backend API: http://localhost:3001"
echo "   - Health Check: http://localhost:3001/api/health"
echo "   - Metrics: http://localhost:3001/api/metrics"

if [ "$deploy_type" == "1" ]; then
    echo "   - PostgreSQL: localhost:5432"
fi

echo ""
echo "📝 Useful commands:"
echo "   - View logs: docker compose logs -f backend"
echo "   - Stop services: docker compose down"
echo "   - Restart: docker compose restart backend"
echo "   - Database shell: docker compose exec postgres psql -U dqmp -d dqmp"
echo ""

# Test health endpoint
echo "🔍 Testing health endpoint..."
sleep 5
if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "✅ Backend is healthy and responding!"
else
    echo "⚠️  Backend health check failed. Check logs with: docker compose logs backend"
fi

echo ""
echo "✨ Deployment complete! Your backend is ready."
