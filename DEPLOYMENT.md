# CI/CD and Docker Deployment Guide

This guide covers the complete CI/CD pipeline and Docker deployment setup for the DQMP Backend.

## Table of Contents

1. [Docker Setup](#docker-setup)
2. [Local Development with Docker](#local-development-with-docker)
3. [CI/CD Pipeline](#cicd-pipeline)
4. [Deployment Options](#deployment-options)
5. [Environment Configuration](#environment-configuration)
6. [Troubleshooting](#troubleshooting)

---

## Docker Setup

### Prerequisites

- Docker Engine 20.10+ and Docker Compose 2.0+
- Git
- GitHub account (for CI/CD)

### Files Overview

- `Dockerfile` - Multi-stage production-ready Docker image
- `.dockerignore` - Files excluded from Docker build context
- `docker-compose.yml` - Local development orchestration
- `.github/workflows/backend-cicd.yml` - Main CI/CD pipeline
- `.github/workflows/deploy-render.yml` - Render deployment workflow

---

## Local Development with Docker

### 1. Environment Setup

Create a `.env` file in the `backend` directory:

```env
# Database
DATABASE_URL=postgresql://dqmp:dqmp_password@postgres:5432/dqmp?schema=public
POSTGRES_USER=dqmp
POSTGRES_PASSWORD=dqmp_password
POSTGRES_DB=dqmp

# Application
NODE_ENV=production
PORT=3001
JWT_SECRET=your-super-secret-jwt-key-change-this

# Frontend CORS
FRONTEND_ORIGIN=http://localhost:3000,http://localhost:5173

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@dqmp.com

# Twilio (Optional)
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
TWILIO_PHONE_NUMBER=your-twilio-phone

# Performance
LOG_LEVEL=info
PERF_LOG=true
PERF_LOG_THRESHOLD_MS=200
COMPRESS_THRESHOLD=1024
LONG_WAIT_MINUTES=10
```

### 2. Build and Run

```bash
# Navigate to backend directory
cd backend

# Build and start all services
docker compose up -d

# View logs
docker compose logs -f backend

# Stop services
docker compose down

# Rebuild after code changes
docker compose up -d --build
```

### 3. Database Management

```bash
# Run migrations
docker compose exec backend npx prisma migrate deploy

# Open Prisma Studio
docker compose exec backend npx prisma studio

# Seed database (if you have seed scripts)
docker compose exec backend npm run seed:outlets
```

### 4. Access Services

- Backend API: http://localhost:3001
- Health Check: http://localhost:3001/api/health
- Metrics: http://localhost:3001/api/metrics
- PostgreSQL: localhost:5432

---

## CI/CD Pipeline

### Workflow Triggers

The CI/CD pipeline automatically runs when:

1. **Push to `main` branch** → Build, Test, Deploy to Production
2. **Push to `develop` branch** → Build, Test, Deploy to Staging
3. **Pull Request** → Build and Test only
4. **Manual Trigger** → Via GitHub Actions UI

### Pipeline Stages

#### Stage 1: Build and Test
- Checkout code
- Setup Node.js 20
- Install dependencies
- Generate Prisma client
- Build TypeScript
- Validate build output

#### Stage 2: Build Docker Image
- Build multi-stage Docker image
- Push to GitHub Container Registry (ghcr.io)
- Tag with branch name, SHA, and `latest`
- Cache layers for faster builds

#### Stage 3: Deploy
- **Production (main branch)**:
  - Deploy via SSH to production server
  - Pull latest Docker image
  - Run database migrations
  - Restart containers
  - Verify health check

- **Staging (develop branch)**:
  - Deploy to staging environment
  - Similar steps as production

### Required GitHub Secrets

Navigate to **Settings → Secrets and variables → Actions** and add:

#### For SSH Deployment

```
DEPLOY_HOST           - Production server IP/hostname
DEPLOY_USER           - SSH username
DEPLOY_SSH_KEY        - SSH private key
DEPLOY_PORT           - SSH port (default: 22)
DEPLOY_PATH           - Deployment directory (default: /opt/dqmp/backend)
PRODUCTION_URL        - Production URL for health checks

STAGING_HOST          - Staging server IP/hostname
STAGING_USER          - SSH username
STAGING_SSH_KEY       - SSH private key
STAGING_PORT          - SSH port (default: 22)
STAGING_DEPLOY_PATH   - Staging deployment directory
STAGING_URL           - Staging URL for health checks
```

#### For Render Deployment

```
RENDER_DEPLOY_HOOK_URL - Render deploy hook URL
RENDER_APP_URL         - Render app URL
```

---

## Deployment Options

### Option 1: Self-Hosted Server (VPS/Cloud VM)

#### Initial Server Setup

```bash
# 1. SSH into your server
ssh user@your-server-ip

# 2. Install Docker and Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# 3. Install Docker Compose
sudo apt update
sudo apt install docker-compose-plugin

# 4. Create deployment directory
sudo mkdir -p /opt/dqmp/backend
sudo chown $USER:$USER /opt/dqmp/backend
cd /opt/dqmp/backend

# 5. Create .env file with production values
nano .env

# 6. Create docker-compose.yml (copy from repository)
nano docker-compose.yml

# 7. Login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# 8. Pull and start
docker compose pull
docker compose up -d

# 9. Check status
docker compose ps
docker compose logs -f backend
```

#### Setup GitHub Deploy Key

```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-deploy-key" -f ~/.ssh/github_deploy_key

# Add public key to server's authorized_keys
ssh-copy-id -i ~/.ssh/github_deploy_key.pub user@your-server-ip

# Add private key to GitHub Secrets as DEPLOY_SSH_KEY
cat ~/.ssh/github_deploy_key
```

### Option 2: Render.com

1. **Connect Repository**
   - Go to Render Dashboard
   - New → Web Service
   - Connect your GitHub repository
   - Select `backend` as root directory

2. **Configure Service**
   ```yaml
   Name: dqmp-backend
   Environment: Docker
   Branch: main
   Dockerfile Path: ./Dockerfile
   ```

3. **Add Environment Variables**
   - Copy from `.env.example`
   - Set `DATABASE_URL` from Render PostgreSQL

4. **Get Deploy Hook**
   - Settings → Deploy Hook
   - Copy URL to `RENDER_DEPLOY_HOOK_URL` GitHub secret

5. **Enable Auto-Deploy**
   - Settings → Auto-Deploy: Yes

### Option 3: Railway.app

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize project
cd backend
railway init

# Link to PostgreSQL
railway add --database postgresql

# Set environment variables
railway variables set NODE_ENV=production
railway variables set JWT_SECRET=your-secret

# Deploy
railway up
```

### Option 4: DigitalOcean App Platform

1. Create new app from GitHub
2. Select repository and `backend` directory
3. Choose Dockerfile build
4. Add PostgreSQL database
5. Configure environment variables
6. Deploy

### Option 5: AWS ECS/Fargate

```bash
# Install AWS CLI and ECS CLI
# Configure AWS credentials
# Create ECR repository
aws ecr create-repository --repository-name dqmp-backend

# Tag and push image
docker tag dqmp-backend:latest <account-id>.dkr.ecr.<region>.amazonaws.com/dqmp-backend:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/dqmp-backend:latest

# Use ECS task definitions and services
```

---

## Environment Configuration

### Production Environment Variables

```env
# Required
DATABASE_URL=postgresql://user:password@host:5432/database
JWT_SECRET=<strong-random-secret-minimum-32-chars>
FRONTEND_ORIGIN=https://your-frontend-domain.com

# Email (Required for notifications)
EMAIL_HOST=smtp.yourprovider.com
EMAIL_PORT=587
EMAIL_USER=your-email@domain.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@domain.com

# Optional
NODE_ENV=production
PORT=3001
LOG_LEVEL=warn
PERF_LOG=true
PERF_LOG_THRESHOLD_MS=500
LONG_WAIT_MINUTES=15

# Twilio (Optional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

### Security Best Practices

1. **Never commit `.env` files** - Use `.env.example` as template
2. **Use strong JWT secrets** - Minimum 32 random characters
3. **Rotate secrets regularly** - Every 90 days
4. **Use managed databases** - RDS, Neon, Supabase, etc.
5. **Enable SSL/TLS** - For database and API connections
6. **Limit CORS origins** - Only allow trusted domains
7. **Use secret management** - AWS Secrets Manager, HashiCorp Vault

---

## Troubleshooting

### Build Failures

```bash
# Check build logs
docker compose logs backend

# Rebuild without cache
docker compose build --no-cache backend

# Check Prisma generation
docker compose exec backend npx prisma generate
```

### Database Connection Issues

```bash
# Check PostgreSQL status
docker compose ps postgres

# Test connection
docker compose exec postgres psql -U dqmp -d dqmp

# View database logs
docker compose logs postgres

# Reset database (⚠️ destroys data)
docker compose down -v
docker compose up -d
```

### Migration Failures

```bash
# Check migration status
docker compose exec backend npx prisma migrate status

# Force reset (development only)
docker compose exec backend npx prisma migrate reset

# Deploy migrations
docker compose exec backend npx prisma migrate deploy
```

### Container Issues

```bash
# Restart services
docker compose restart backend

# View resource usage
docker stats

# Check container health
docker inspect dqmp-backend | grep -A 10 Health

# Access container shell
docker compose exec backend sh
```

### GitHub Actions Failures

1. **Check workflow logs** - Actions tab → Failed workflow
2. **Verify secrets** - Settings → Secrets → Check all required secrets
3. **SSH connection issues** - Test SSH key authentication manually
4. **Image pull failures** - Verify GitHub Container Registry permissions

### Performance Issues

```bash
# Check metrics endpoint
curl http://localhost:3001/api/metrics

# Monitor container resources
docker stats dqmp-backend

# Analyze logs
docker compose logs backend | grep "slow_request"

# Database query performance
docker compose exec backend npx prisma studio
```

---

## Monitoring and Maintenance

### Health Checks

```bash
# Local health check
curl http://localhost:3001/api/health

# Production health check
curl https://your-domain.com/api/health

# Expected response
{"status":"ok","timestamp":"2026-02-28T12:00:00.000Z"}
```

### Log Management

```bash
# Follow logs
docker compose logs -f backend

# Last 100 lines
docker compose logs --tail=100 backend

# Save logs to file
docker compose logs backend > backend-logs.txt
```

### Backup Database

```bash
# Create backup
docker compose exec postgres pg_dump -U dqmp dqmp > backup-$(date +%Y%m%d).sql

# Restore backup
docker compose exec -T postgres psql -U dqmp dqmp < backup-20260228.sql
```

### Update Deployment

```bash
# Pull latest changes
cd /opt/dqmp/backend
git pull origin main

# Pull latest image
docker compose pull backend

# Restart with zero downtime
docker compose up -d --no-deps --build backend
```

---

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)

---

## Support

For issues or questions:
1. Check this documentation
2. Review GitHub Actions logs
3. Check Docker container logs
4. Contact DevOps team

**Last Updated:** February 28, 2026
