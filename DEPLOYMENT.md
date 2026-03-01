# Automated CI/CD Deployment Guide

This project uses **GitHub Actions CI/CD** for fully automated deployment. No manual Docker commands needed!

## 🚀 How Deployment Works

Deployment is **fully automated** via GitHub Actions:

1. **Push code to `main` or `new-logins-back` branch**
2. GitHub Actions automatically:
   - ✅ Builds Docker image with Alpine Linux + Prisma
   - ✅ Pushes to GitHub Container Registry (GHCR)
   - ✅ SSH into Rocky Linux VM
   - ✅ Pulls latest image
   - ✅ Stops old container & starts new one
   - ✅ Runs database migrations
   - ✅ Performs health checks
   - ✅ Rolls back if health check fails

**Total deployment time:** ~6-7 minutes

## 📋 Prerequisites

### 1. GitHub Secrets Configuration

Configure these in: **Repository Settings → Secrets and variables → Actions**

#### VM Connection Secrets
```
VM_HOST          = 192.168.x.x (your Rocky Linux VM IP)
VM_SSH_PORT      = 22 (or your custom SSH port)
VM_USERNAME      = your-vm-username
VM_SSH_KEY       = (paste your private SSH key)
```

#### Application Environment Secret
```
APP_ENV = (paste complete .env file content below)
```

**APP_ENV Content:**
```env
# Database (External - Neon/Hosted PostgreSQL)
DATABASE_URL=postgresql://user:password@host.region.neon.tech:5432/database?sslmode=require

# Application
NODE_ENV=production
PORT=3001
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Frontend Origin (comma-separated for CORS)
FRONTEND_ORIGIN=https://yourdomain.com,http://localhost:3000

# Email Configuration (Gmail example)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-gmail-app-password
EMAIL_FROM=DQMP Notifications <noreply@yourdomain.com>

# Twilio SMS (Optional)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# Performance & Logging
LOG_LEVEL=info
PERF_LOG=true
PERF_LOG_THRESHOLD_MS=200
COMPRESS_THRESHOLD=1024
LONG_WAIT_MINUTES=10
```

### 2. Rocky Linux VM Setup

Your VM must have:
- ✅ Docker & Docker Compose installed
- ✅ SSH access enabled
- ✅ Port 3500 open (for backend API)
- ✅ `/opt/app` directory created with proper permissions
- ✅ User has sudo privileges for Docker commands

**One-time VM setup:**
```bash
# Create deployment directory
sudo mkdir -p /opt/app
sudo chown $USER:$USER /opt/app

# Ensure Docker is running
sudo systemctl enable docker
sudo systemctl start docker
```

## 🔄 Deployment Workflow

### Automatic Deployment (Recommended)

```bash
# 1. Make your changes
git add .
git commit -m "feat: your feature description"

# 2. Push to trigger deployment
git push origin new-logins-back

# 3. Monitor GitHub Actions
# Visit: https://github.com/Digital-Queue-Management-Platform/DQMS-final-backend/actions
```

### Manual Trigger (From GitHub UI)

1. Go to **Actions** tab
2. Select **CI/CD Pipeline** workflow
3. Click **Run workflow** button
4. Choose branch and click **Run workflow**

## 📊 Monitoring Deployment

### View Logs in GitHub Actions

1. Go to [Actions](https://github.com/Digital-Queue-Management-Platform/DQMS-final-backend/actions)
2. Click on the latest workflow run
3. View **build-and-push** and **deploy** job logs

### SSH into VM to Check Status

```bash
# SSH into your VM
ssh -p 22 username@your-vm-ip

# Check container status
cd /opt/app
sudo docker compose ps

# View logs
sudo docker compose logs -f backend

# Check health endpoint
curl http://localhost:3001/api/health
```

## 🏗️ Architecture

### CI/CD Pipeline Stages

```
┌─────────────────────────────────────────────────────┐
│  GitHub Push (main/new-logins-back)                 │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│  BUILD-AND-PUSH JOB                                 │
│  1. Checkout code                                   │
│  2. Build Docker image (Alpine + Prisma)            │
│  3. Push to ghcr.io with tags:                      │
│     - latest                                        │
│     - sha-7chars                                    │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│  DEPLOY JOB                                         │
│  1. Copy docker-compose.prod.yml to VM              │
│  2. SSH into VM                                     │
│  3. Create .env from secrets                        │
│  4. Pull new image                                  │
│  5. Stop & remove old container                     │
│  6. Kill stale processes on port 3500               │
│  7. Start new container                             │
│  8. Run Prisma migrations                           │
│  9. Health check (30s timeout)                      │
│  10. Success or Rollback                            │
└─────────────────────────────────────────────────────┘
```

### Production Stack

```
┌─────────────────────────────────────────────┐
│  Rocky Linux 9 VM (192.168.x.x)             │
│  ┌─────────────────────────────────────┐   │
│  │  Docker Container (dqmp-backend)    │   │
│  │  ├─ Node.js 20 (Alpine Linux)       │   │
│  │  ├─ Prisma ORM                      │   │
│  │  ├─ Express API                     │   │
│  │  └─ Port 3001 (internal)            │   │
│  │      → Port 3500 (external)         │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  External PostgreSQL Database               │
│  (Neon / Hosted)                            │
└─────────────────────────────────────────────┘
```

## 🐛 Troubleshooting

### Deployment Failed

**Check GitHub Actions logs:**
```
1. Go to Actions tab
2. Click failed workflow run
3. Expand "Deploy to Rocky Linux VM" step
4. Look for error messages
```

**Common Issues:**

#### Port 3500 Already in Use
```bash
# SSH into VM
sudo fuser -k 3500/tcp
sudo docker compose restart backend
```

#### Database Connection Failed
```bash
# Check DATABASE_URL in APP_ENV secret
# Ensure Neon database is accessible
# Verify firewall allows outbound connections
```

#### Prisma Migration Failed
```bash
# SSH into VM
cd /opt/app
sudo docker compose exec backend npx prisma migrate deploy
sudo docker compose logs backend
```

#### Container Keeps Restarting
```bash
# View container logs
sudo docker compose logs -f backend

# Check if migrations ran
sudo docker compose exec backend npx prisma migrate status

# Restart container
sudo docker compose restart backend
```

### Health Check Never Passes

```bash
# SSH into VM
cd /opt/app

# Check if container is running
sudo docker compose ps

# Check logs for errors
sudo docker compose logs --tail=100 backend

# Test health endpoint manually
curl http://localhost:3001/api/health

# Restart if needed
sudo docker compose down
sudo docker compose up -d
```

## 📦 Container Management

### View Running Containers
```bash
sudo docker compose ps
```

### View Logs
```bash
# Follow logs
sudo docker compose logs -f backend

# Last 100 lines
sudo docker compose logs --tail=100 backend
```

### Restart Container
```bash
sudo docker compose restart backend
```

### Stop & Remove
```bash
sudo docker compose down
```

### Access Container Shell
```bash
sudo docker compose exec backend sh
```

### Run Migrations Manually
```bash
sudo docker compose exec backend npx prisma migrate deploy
```

## 🔐 Security Notes

- ✅ Container runs as non-root `node` user
- ✅ Secrets stored in GitHub Actions (encrypted)
- ✅ SSH key-based authentication only
- ✅ Database connections use SSL
- ✅ No credentials in code or logs

## 📝 Deployment Checklist

Before deploying to production:

- [ ] Update `APP_ENV` secret with production values
- [ ] Set strong `JWT_SECRET`
- [ ] Configure production `DATABASE_URL`
- [ ] Set correct `FRONTEND_ORIGIN`
- [ ] Configure email SMTP settings
- [ ] Test database connection
- [ ] Verify VM SSH access
- [ ] Check port 3500 is open
- [ ] Review GitHub Actions logs
- [ ] Test health endpoint after deployment

## 🆘 Support

If deployment fails after multiple attempts:

1. Check GitHub Actions logs
2. SSH into VM and check Docker logs
3. Verify all GitHub secrets are correct
4. Ensure database is accessible
5. Check VM disk space: `df -h`
6. Check Docker status: `sudo systemctl status docker`

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Prisma Deployment Guide](https://www.prisma.io/docs/guides/deployment)
- [Alpine Linux Packages](https://pkgs.alpinelinux.org/)

---

**Last Updated:** March 1, 2026  
**Deployment Method:** Automated CI/CD via GitHub Actions  
**Manual Deployment:** ❌ Not supported (use GitHub Actions only)
