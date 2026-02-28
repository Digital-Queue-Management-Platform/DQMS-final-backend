# DQMP Backend Quick Deploy Script (PowerShell)
# This script helps you quickly deploy the backend using Docker on Windows

Write-Host "[*] DQMP Backend Deployment Script" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is installed
$dockerInstalled = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerInstalled) {
    Write-Host "[ERROR] Docker is not installed. Please install Docker Desktop first." -ForegroundColor Red
    Write-Host "Visit: https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Docker is installed" -ForegroundColor Green
Write-Host ""

# Check if .env file exists
if (-not (Test-Path .env)) {
    Write-Host "[WARNING] .env file not found!" -ForegroundColor Yellow
    Write-Host "Creating .env from .env.example..." -ForegroundColor Yellow
    
    if (Test-Path .env.example) {
        Copy-Item .env.example .env
        Write-Host "[OK] .env file created. Please edit it with your configuration." -ForegroundColor Green
        Write-Host ""
        Write-Host "[IMPORTANT] Update the following in .env:" -ForegroundColor Yellow
        Write-Host "   - DATABASE_URL" -ForegroundColor Yellow
        Write-Host "   - JWT_SECRET (use a strong random string)" -ForegroundColor Yellow
        Write-Host "   - EMAIL_* settings" -ForegroundColor Yellow
        Write-Host "   - FRONTEND_ORIGIN" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Press Enter to continue after updating .env file"
    } else {
        Write-Host "[ERROR] .env.example not found. Please create .env file manually." -ForegroundColor Red
        exit 1
    }
}

Write-Host "[OK] .env file found" -ForegroundColor Green
Write-Host ""

# Ask deployment type
Write-Host "Select deployment type:" -ForegroundColor Cyan
Write-Host "1) Development (with PostgreSQL in Docker)"
Write-Host "2) Production (requires external database)"
$deployType = Read-Host "Enter choice (1 or 2)"

if ($deployType -eq "1") {
    Write-Host ""
    Write-Host "[BUILD] Building and starting services (Development)..." -ForegroundColor Yellow
    docker compose up -d --build
    
    Write-Host ""
    Write-Host "[WAIT] Waiting for database to be ready..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    Write-Host "[MIGRATE] Running database migrations..." -ForegroundColor Yellow
    docker compose exec backend npx prisma migrate deploy
    
} elseif ($deployType -eq "2") {
    Write-Host ""
    Write-Host "[BUILD] Building backend only (Production)..." -ForegroundColor Yellow
    docker compose up -d --build backend
    
    Write-Host ""
    Write-Host "[WAIT] Waiting for backend to start..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    Write-Host "[MIGRATE] Running database migrations..." -ForegroundColor Yellow
    docker compose exec backend npx prisma migrate deploy
} else {
    Write-Host "[ERROR] Invalid choice" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[SUCCESS] Deployment completed!" -ForegroundColor Green
Write-Host ""
Write-Host "[STATUS] Service Status:" -ForegroundColor Cyan
docker compose ps

Write-Host ""
Write-Host "[SERVICES] Available Services:" -ForegroundColor Cyan
Write-Host "   - Backend API: http://localhost:3001"
Write-Host "   - Health Check: http://localhost:3001/api/health"
Write-Host "   - Metrics: http://localhost:3001/api/metrics"

if ($deployType -eq "1") {
    Write-Host "   - PostgreSQL: localhost:5432"
}

Write-Host ""
Write-Host "[COMMANDS] Useful commands:" -ForegroundColor Cyan
Write-Host "   - View logs: docker compose logs -f backend"
Write-Host "   - Stop services: docker compose down"
Write-Host "   - Restart: docker compose restart backend"
Write-Host "   - Database shell: docker compose exec postgres psql -U dqmp -d dqmp"
Write-Host ""

# Test health endpoint
Write-Host "[TEST] Testing health endpoint..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/api/health" -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "[OK] Backend is healthy and responding!" -ForegroundColor Green
    }
} catch {
    Write-Host "[WARNING] Backend health check failed. Check logs with: docker compose logs backend" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[DONE] Deployment complete! Your backend is ready." -ForegroundColor Cyan
