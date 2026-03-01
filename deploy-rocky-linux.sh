#!/bin/bash

# DQMP Backend Deployment Script for Rocky Linux
# This script handles manual deployment to Rocky Linux VM

set -e

echo "🚀 DQMP Rocky Linux Deployment Script"
echo "======================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo "ℹ️  $1"
}

# Check if running on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    print_error "This script must be run on a Linux system (Rocky Linux VM)"
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed!"
    print_info "Installing Docker on Rocky Linux..."
    
    sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo systemctl enable --now docker
    
    # Add current user to docker group
    sudo usermod -aG docker $USER
    
    print_warning "Docker installed. Please log out and log back in for group changes to take effect."
    print_info "After logging back in, run this script again."
    exit 0
fi

print_success "Docker is installed"

# Check if Docker Compose is available
if ! docker compose version &> /dev/null; then
    print_error "Docker Compose is not available!"
    print_info "Please install Docker Compose plugin"
    exit 1
fi

print_success "Docker Compose is available"

# Check if .env file exists
if [ ! -f .env ]; then
    print_error ".env file not found!"
    
    if [ -f .env.example ]; then
        print_info "Creating .env from .env.example..."
        cp .env.example .env
        print_warning "Please edit .env with your production configuration"
        print_info "Required variables:"
        echo "  - DATABASE_URL"
        echo "  - JWT_SECRET"
        echo "  - EMAIL_* settings"
        echo "  - FRONTEND_ORIGIN"
        echo ""
        read -p "Press Enter after updating .env file..."
    else
        print_error ".env.example not found. Please create .env manually."
        exit 1
    fi
fi

print_success ".env file found"

# Check if docker-compose.yml exists
if [ ! -f docker-compose.yml ] && [ ! -f docker-compose.prod.yml ]; then
    print_error "No docker-compose file found!"
    exit 1
fi

# Use production compose file if it exists
COMPOSE_FILE="docker-compose.yml"
if [ -f docker-compose.prod.yml ]; then
    COMPOSE_FILE="docker-compose.prod.yml"
    print_info "Using production compose file"
fi

# Ask for deployment action
echo ""
echo "Select deployment action:"
echo "1) Fresh deployment (pull latest image and start)"
echo "2) Rolling update (pull new image and restart)"
echo "3) Rebuild from source"
echo "4) Stop services"
echo "5) View logs"
echo "6) Check status"
read -p "Enter choice (1-6): " action

case $action in
    1)
        print_info "Starting fresh deployment..."
        
        # Pull latest images
        print_info "Pulling latest images..."
        docker compose -f $COMPOSE_FILE pull
        
        # Start services
        print_info "Starting services..."
        docker compose -f $COMPOSE_FILE up -d
        
        # Quick wait for startup
        print_info "Waiting for services to start (10s)..."
        sleep 10
        
        # Run migrations
        print_info "Running database migrations..."
        docker compose -f $COMPOSE_FILE exec -T backend npx prisma migrate deploy || {
            print_warning "Migration warning - may retry in a moment"
        }
        
        # Quick health check (30s max)
        print_info "Checking service health (30s max)..."
        for i in {1..10}; do
            if curl -f -s http://localhost:3001/api/health > /dev/null 2>&1; then
                print_success "Fresh deployment completed!"
                docker compose -f $COMPOSE_FILE ps
                exit 0
            fi
            sleep 3
        done
        
        # Still check if container is running
        if docker ps | grep -q dqmp-backend; then
            print_success "Deployment completed (container running)!"
            docker compose -f $COMPOSE_FILE ps
        else
            print_warning "Container status unclear. Check logs."
            docker compose -f $COMPOSE_FILE logs --tail=50 backend
        fi
        ;;
        
    2)
        print_info "Starting rolling update..."
        
        # Pull latest images
        print_info "Pulling latest images..."
        docker compose -f $COMPOSE_FILE pull
        
        # Rolling restart (minimal downtime)
        print_info "Performing rolling restart..."
        docker compose -f $COMPOSE_FILE up -d --no-deps backend
        
        # Quick wait
        sleep 5
        
        # Run migrations
        print_info "Running database migrations..."
        docker compose -f $COMPOSE_FILE exec -T backend npx prisma migrate deploy || true
        
        # Quick health check (30s max)
        print_info "Verifying deployment (30s max)..."
        for i in {1..10}; do
            if curl -f -s http://localhost:3001/api/health > /dev/null 2>&1; then
                print_success "Rolling update completed successfully!"
                docker compose -f $COMPOSE_FILE ps
                exit 0
            fi
            sleep 3
        done
        
        if docker ps | grep -q "dqmp-backend.*Up"; then
            print_success "Rolling update completed!"
            docker compose -f $COMPOSE_FILE ps
        else
            print_error "Container may not be healthy. Checking logs..."
            docker compose -f $COMPOSE_FILE logs --tail=50 backend
            exit 1
        fi
        ;;
        
    3)
        print_info "Rebuilding from source..."
        
        # Build and start
        docker compose -f $COMPOSE_FILE up -d --build
        
        print_info "Waiting for services (15s)..."
        sleep 15
        
        # Run migrations
        print_info "Running database migrations..."
        docker compose -f $COMPOSE_FILE exec -T backend npx prisma migrate deploy || true
        
        print_success "Rebuild completed!"
        ;;
        
    4)
        print_info "Stopping services..."
        docker compose -f $COMPOSE_FILE down
        print_success "Services stopped"
        ;;
        
    5)
        print_info "Displaying logs..."
        docker compose -f $COMPOSE_FILE logs -f
        ;;
        
    6)
        print_info "Checking status..."
        echo ""
        docker compose -f $COMPOSE_FILE ps
        echo ""
        
        # Check if backend is healthy
        if docker ps | grep dqmp-backend | grep -q "healthy\|Up"; then
            print_success "Backend is running"
            
            # Test health endpoint
            print_info "Testing health endpoint..."
            if curl -f http://localhost:3001/api/health &> /dev/null; then
                print_success "Health endpoint responding"
            else
                print_warning "Health endpoint not responding"
            fi
        else
            print_warning "Backend may not be running properly"
        fi
        ;;
        
    *)
        print_error "Invalid choice"
        exit 1
        ;;
esac

echo ""
print_info "Deployment Summary:"
echo "  - Backend API: http://YOUR_VM_IP:3001"
echo "  - Health Check: http://YOUR_VM_IP:3001/api/health"
echo "  - Metrics: http://YOUR_VM_IP:3001/api/metrics"
echo ""
print_info "Useful commands:"
echo "  - View logs: docker compose -f $COMPOSE_FILE logs -f backend"
echo "  - Check status: docker compose -f $COMPOSE_FILE ps"
echo "  - Restart: docker compose -f $COMPOSE_FILE restart backend"
echo "  - Run migrations: docker compose -f $COMPOSE_FILE exec backend npx prisma migrate deploy"
echo "  - Access shell: docker compose -f $COMPOSE_FILE exec backend sh"
echo ""
