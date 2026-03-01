#!/bin/bash
# scripts/setup-vm.sh
# Required on the Rocky Linux 9 VM before first deploy
# Run once as root or user with sudo access

set -e

echo "=========================================="
echo " Rocky Linux 9 VM Setup for DQMP Backend"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_info() { echo "ℹ️  $1"; }

# Check if script is run as root
if [ "$EUID" -ne 0 ]; then
  print_error "Please run this script as root (or with sudo)"
  echo "Example: sudo ./setup-vm.sh 'ssh-ed25519 AAAA... ci-cd-key'"
  exit 1
fi

APP_PORT=3001
APP_DIR="/opt/app"
DEPLOY_USER="deploy"

print_info "Starting setup process..."
echo ""

# 1. Update system packages
print_info "Updating system packages..."
dnf update -y || print_warning "System update had some issues, continuing..."
print_success "System updated"

# 2. Install Docker Engine
if ! command -v docker &> /dev/null; then
    print_info "Installing Docker Engine..."
    
    # Remove old versions if any
    dnf remove -y docker docker-client docker-client-latest docker-common \
        docker-latest docker-latest-logrotate docker-logrotate docker-engine \
        podman runc 2>/dev/null || true
    
    # Install required packages
    dnf install -y dnf-plugins-core
    
    # Add Docker repository
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    
    # Install Docker
    dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Start and enable Docker
    systemctl enable --now docker
    
    # Verify installation
    if docker --version && docker compose version; then
        print_success "Docker and Docker Compose installed successfully"
    else
        print_error "Docker installation failed"
        exit 1
    fi
else
    print_success "Docker is already installed ($(docker --version))"
fi

# 3. Create deploy user
if ! id "$DEPLOY_USER" &>/dev/null; then
    print_info "Creating $DEPLOY_USER user..."
    useradd -m -s /bin/bash $DEPLOY_USER
    usermod -aG docker $DEPLOY_USER
    print_success "User '$DEPLOY_USER' created"
else
    print_success "User '$DEPLOY_USER' already exists"
    print_info "Ensuring user is in docker group..."
    usermod -aG docker $DEPLOY_USER
fi

# 4. Add CI/CD system's SSH public key
if [ -z "$1" ]; then
    print_warning "No SSH public key provided as an argument"
    print_info "You will need to manually add your CI/CD SSH key to:"
    echo "    /home/$DEPLOY_USER/.ssh/authorized_keys"
    echo ""
    print_info "Generate a key on your CI/CD system:"
    echo "    ssh-keygen -t ed25519 -C 'ci-cd-deploy'"
    echo "Then run this script again with the public key as argument:"
    echo "    sudo ./setup-vm.sh 'YOUR_PUBLIC_KEY_HERE'"
else
    print_info "Adding SSH public key to $DEPLOY_USER user..."
    mkdir -p /home/$DEPLOY_USER/.ssh
    
    # Append key if not already present
    if ! grep -qF "$1" /home/$DEPLOY_USER/.ssh/authorized_keys 2>/dev/null; then
        echo "$1" >> /home/$DEPLOY_USER/.ssh/authorized_keys
        print_success "SSH key added"
    else
        print_info "SSH key already exists"
    fi
    
    chmod 700 /home/$DEPLOY_USER/.ssh
    chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
    chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
fi

# 5. Create app directory
print_info "Setting up application directory $APP_DIR..."
mkdir -p $APP_DIR
chown $DEPLOY_USER:$DEPLOY_USER $APP_DIR
chmod 755 $APP_DIR
print_success "Application directory created"

# 6. Configure firewall
print_info "Configuring firewall for port $APP_PORT..."
if systemctl is-active --quiet firewalld; then
    # Open HTTP/HTTPS if not already open
    firewall-cmd --permanent --add-service=http 2>/dev/null || true
    firewall-cmd --permanent --add-service=https 2>/dev/null || true
    
    # Open application port
    if ! firewall-cmd --list-ports | grep -q "${APP_PORT}/tcp"; then
        firewall-cmd --permanent --add-port=${APP_PORT}/tcp
        firewall-cmd --reload
        print_success "Firewall rules updated (port $APP_PORT opened)"
    else
        print_info "Port $APP_PORT already open in firewall"
    fi
    
    print_info "Active firewall rules:"
    firewall-cmd --list-all
else
    print_warning "firewalld is not active. Installing and enabling..."
    dnf install -y firewalld
    systemctl enable --now firewalld
    firewall-cmd --permanent --add-port=${APP_PORT}/tcp
    firewall-cmd --permanent --add-service=ssh
    firewall-cmd --reload
    print_success "Firewall configured and enabled"
fi

# 7. Configure SELinux (if enforcing)
if command -v getenforce &> /dev/null; then
    if [ "$(getenforce)" != "Disabled" ]; then
        print_info "Configuring SELinux for Docker..."
        # Install SELinux policy tools
        dnf install -y policycoreutils-python-utils
        
        # Allow Docker to access app directory
        semanage fcontext -a -t container_file_t "$APP_DIR(/.*)?" 2>/dev/null || true
        restorecon -Rv $APP_DIR 2>/dev/null || true
        
        print_success "SELinux configured"
    fi
fi

# 8. Test Docker installation
print_info "Testing Docker installation..."
if systemctl is-active --quiet docker; then
    print_success "Docker service is running"
    
    # Test with hello-world
    if docker run --rm hello-world &>/dev/null; then
        print_success "Docker is working correctly"
    else
        print_warning "Docker test failed, but service is running"
    fi
else
    print_error "Docker service is not running!"
    systemctl start docker
fi

# 9. Install useful utilities
print_info "Installing useful utilities..."
dnf install -y curl wget git nano vim htop 2>/dev/null || print_warning "Some utilities may not have installed"

echo ""
echo "=========================================="
print_success "VM Setup Complete!"
echo "=========================================="
echo ""
print_info "Summary:"
echo "  ✓ Docker: $(docker --version)"
echo "  ✓ Docker Compose: $(docker compose version)"
echo "  ✓ Deploy user: $DEPLOY_USER (with docker group access)"
echo "  ✓ App directory: $APP_DIR"
echo "  ✓ Firewall: Port $APP_PORT open"
echo ""
print_info "GitHub Secrets Required:"
echo "  - VM_HOST: $(hostname -I | awk '{print $1}')"
echo "  - VM_SSH_PORT: 22 (or your custom SSH port)"
echo "  - VM_SSH_KEY: Your private SSH key"
echo "  - APP_ENV: Your .env file contents"
echo ""
print_info "Next Steps:"
echo "  1. Configure GitHub Secrets in your repository"
echo "  2. Push code to main branch to trigger deployment"
echo "  3. Monitor deployment in GitHub Actions"
echo ""
print_info "Manual Deployment:"
echo "  1. SSH to VM: ssh $DEPLOY_USER@$(hostname -I | awk '{print $1}')"
echo "  2. Navigate to app: cd $APP_DIR"
echo "  3. Run deployment script: ./deploy-rocky-linux.sh"
echo ""
print_warning "IMPORTANT: Log out and log back in for docker group changes to take effect!"
echo ""
