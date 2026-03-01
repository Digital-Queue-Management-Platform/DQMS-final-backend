#!/bin/bash

# DQMP Deployment Health Check Script for Rocky Linux
# Run this on your Rocky Linux VM to diagnose deployment issues

echo "=========================================="
echo " DQMP Deployment Health Check"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASS${NC}: $1"; }
fail() { echo -e "${RED}❌ FAIL${NC}: $1"; }
warn() { echo -e "${YELLOW}⚠️  WARN${NC}: $1"; }
info() { echo -e "${BLUE}ℹ️  INFO${NC}: $1"; }

ERRORS=0

echo "1. System Information"
echo "--------------------"
echo "OS: $(cat /etc/redhat-release 2>/dev/null || echo 'Unknown')"
echo "Kernel: $(uname -r)"
echo "Hostname: $(hostname)"
echo "IP: $(hostname -I | awk '{print $1}')"
echo ""

echo "2. Docker Installation"
echo "--------------------"
if command -v docker &> /dev/null; then
    pass "Docker is installed: $(docker --version)"
    
    if systemctl is-active --quiet docker; then
        pass "Docker service is running"
    else
        fail "Docker service is not running"
        ERRORS=$((ERRORS + 1))
        info "Fix: sudo systemctl start docker"
    fi
    
    if docker compose version &> /dev/null; then
        pass "Docker Compose is available: $(docker compose version | head -1)"
    else
        fail "Docker Compose not found"
        ERRORS=$((ERRORS + 1))
        info "Fix: sudo dnf install docker-compose-plugin"
    fi
else
    fail "Docker is not installed"
    ERRORS=$((ERRORS + 1))
    info "Fix: Run scripts/setup-vm.sh"
fi
echo ""

echo "3. User and Permissions"
echo "----------------------"
current_user=$(whoami)
echo "Current user: $current_user"

if id -nG | grep -qw docker; then
    pass "User is in docker group"
else
    warn "User is not in docker group"
    info "Fix: sudo usermod -aG docker $current_user && logout"
fi

if [ -d "/opt/app" ]; then
    pass "Application directory exists: /opt/app"
    
    if [ -w "/opt/app" ]; then
        pass "Application directory is writable"
    else
        fail "Application directory is not writable"
        ERRORS=$((ERRORS + 1))
        info "Fix: sudo chown -R $current_user:$current_user /opt/app"
    fi
else
    fail "Application directory does not exist"
    ERRORS=$((ERRORS + 1))
    info "Fix: sudo mkdir -p /opt/app && sudo chown $current_user:$current_user /opt/app"
fi
echo ""

echo "4. Application Files"
echo "-------------------"
cd /opt/app 2>/dev/null || {
    fail "Cannot access /opt/app"
    ERRORS=$((ERRORS + 1))
    exit 1
}

if [ -f "docker-compose.yml" ] || [ -f "docker-compose.prod.yml" ]; then
    pass "Docker Compose file found"
    
    if [ -f "docker-compose.yml" ]; then
        info "Using: docker-compose.yml"
    else
        info "Using: docker-compose.prod.yml"
    fi
else
    fail "No docker-compose file found"
    ERRORS=$((ERRORS + 1))
    info "Fix: Ensure deployment process copies docker-compose.prod.yml"
fi

if [ -f ".env" ]; then
    pass ".env file exists"
    
    # Check critical variables
    if grep -q "DATABASE_URL=" .env; then
        pass "DATABASE_URL is set"
    else
        fail "DATABASE_URL is missing from .env"
        ERRORS=$((ERRORS + 1))
    fi
    
    if grep -q "JWT_SECRET=" .env; then
        pass "JWT_SECRET is set"
    else
        fail "JWT_SECRET is missing from .env"
        ERRORS=$((ERRORS + 1))
    fi
    
    if grep -q "DOCKER_IMAGE=" .env; then
        pass "DOCKER_IMAGE is set"
        DOCKER_IMAGE=$(grep "DOCKER_IMAGE=" .env | cut -d'=' -f2)
        info "Image: $DOCKER_IMAGE"
    else
        warn "DOCKER_IMAGE not set (may build from source)"
    fi
else
    fail ".env file does not exist"
    ERRORS=$((ERRORS + 1))
    info "Fix: Create .env file with required variables"
fi
echo ""

echo "5. Docker Containers"
echo "-------------------"
if docker ps -a | grep -q dqmp; then
    pass "DQMP containers exist"
    
    echo "Container Status:"
    docker ps -a | grep dqmp | awk '{print "  "$2" - "$7}'
    
    if docker ps | grep -q "dqmp-backend.*Up"; then
        pass "Backend container is running"
        
        # Check if healthy
        if docker inspect dqmp-backend 2>/dev/null | grep -q '"Status": "healthy"'; then
            pass "Backend container is healthy"
        elif docker ps | grep dqmp-backend | grep -q "unhealthy"; then
            warn "Backend container is unhealthy"
            info "Check logs: docker compose logs backend"
        else
            info "Backend container health status unknown"
        fi
    else
        fail "Backend container is not running"
        ERRORS=$((ERRORS + 1))
        info "Fix: docker compose up -d"
    fi
    
    if docker ps | grep -q "dqmp-postgres.*Up"; then
        pass "PostgreSQL container is running"
    else
        info "PostgreSQL container not found (may use external DB)"
    fi
else
    warn "No DQMP containers found"
    info "Containers may not be deployed yet"
fi
echo ""

echo "6. Firewall Configuration"
echo "------------------------"
if systemctl is-active --quiet firewalld; then
    pass "Firewall is active"
    
    if firewall-cmd --list-ports | grep -q "3001/tcp"; then
        pass "Port 3001 is open in firewall"
    else
        fail "Port 3001 is not open in firewall"
        ERRORS=$((ERRORS + 1))
        info "Fix: sudo firewall-cmd --permanent --add-port=3001/tcp && sudo firewall-cmd --reload"
    fi
else
    warn "Firewall is not active"
    info "Consider enabling: sudo systemctl enable --now firewalld"
fi
echo ""

echo "7. Network Connectivity"
echo "----------------------"
if ss -tlnp | grep -q ":3001"; then
    pass "Port 3001 is listening"
    
    # Test local connection
    if curl -f -s http://localhost:3001/api/health > /dev/null 2>&1; then
        pass "Backend health endpoint is responding locally"
    else
        fail "Backend health endpoint is not responding"
        ERRORS=$((ERRORS + 1))
        info "Check: docker compose logs backend"
    fi
else
    fail "Port 3001 is not listening"
    ERRORS=$((ERRORS + 1))
    info "Backend may not be running or port is different"
fi
echo ""

echo "8. Recent Logs"
echo "-------------"
if docker ps | grep -q dqmp-backend; then
    echo "Last 10 lines of backend logs:"
    docker compose logs --tail=10 backend 2>/dev/null || docker logs --tail=10 dqmp-backend 2>/dev/null
else
    info "Backend container not running - no logs available"
fi
echo ""

echo "=========================================="
echo " Health Check Summary"
echo "=========================================="
if [ $ERRORS -eq 0 ]; then
    pass "All checks passed! Deployment appears healthy."
else
    fail "Found $ERRORS issue(s) that need attention"
    echo ""
    echo "Common fixes:"
    echo "  1. Restart Docker: sudo systemctl restart docker"
    echo "  2. Restart containers: docker compose restart"
    echo "  3. View logs: docker compose logs -f backend"
    echo "  4. Rebuild: docker compose up -d --build"
    echo ""
    echo "For detailed troubleshooting, see:"
    echo "  - ROCKY_LINUX_TROUBLESHOOTING.md"
    echo "  - Use: ./deploy-rocky-linux.sh for manual deployment"
fi
echo ""

exit $ERRORS
