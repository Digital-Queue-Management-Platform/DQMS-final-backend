# Quick Start Guide - Docker Deployment

## Prerequisites

- Docker and Docker Compose installed
- Git
- `.env` file configured

## Quick Deploy

### Windows (PowerShell)

```powershell
cd backend
.\deploy-docker.ps1
```

### Linux/Mac (Bash)

```bash
cd backend
chmod +x deploy-docker.sh
./deploy-docker.sh
```

## Manual Setup

### 1. Create Environment File

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 2. Start Services

```bash
# Development (with PostgreSQL)
docker compose up -d

# Production (external database)
docker compose up -d backend
```

### 3. Run Migrations

```bash
docker compose exec backend npx prisma migrate deploy
```

### 4. Verify Deployment

```bash
curl http://localhost:3001/api/health
```

## Common Commands

```bash
# View logs
docker compose logs -f backend

# Restart service
docker compose restart backend

# Stop all services
docker compose down

# Rebuild after code changes
docker compose up -d --build

# Access database
docker compose exec postgres psql -U dqmp -d dqmp

# Run Prisma Studio
docker compose exec backend npx prisma studio
```

## Troubleshooting

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed troubleshooting guide.

## CI/CD Setup

1. Push to `main` branch → Auto-deploy to production
2. Push to `develop` branch → Auto-deploy to staging
3. Configure GitHub Secrets (see DEPLOYMENT.md)

## Support

For detailed documentation, see:
- [DEPLOYMENT.md](DEPLOYMENT.md) - Complete deployment guide
- [README.md](README.md) - API documentation
