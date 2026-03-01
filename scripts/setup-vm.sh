#!/bin/bash
# scripts/setup-vm.sh
# Required on the Rocky Linux 9 VM before first deploy
# Run once as root or user with sudo access

set -e

echo "Starting Rocky Linux 9 VM Setup for DQMS Deployment"

# Check if script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script as root (or with sudo)."
  exit 1
fi

APP_PORT=3001

# 1. Install Docker Engine
if ! command -v docker &> /dev/null; then
    echo "Installing Docker Engine..."
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable --now docker
else
    echo "Docker is already installed."
fi

# 2. Create deploy user
if ! id "deploy" &>/dev/null; then
    echo "Creating deploy user..."
    useradd -m -s /bin/bash deploy
    usermod -aG docker deploy
else
    echo "User 'deploy' already exists. Making sure it is in docker group..."
    usermod -aG docker deploy
fi

# 3. Add CI/CD system's SSH public key
# Requires SSH pub key passed as argument or piped
if [ -z "$1" ]; then
    echo "WARNING: No SSH public key provided as an argument. You will need to manually add it to /home/deploy/.ssh/authorized_keys"
else
    echo "Adding SSH public key to deploy user..."
    mkdir -p /home/deploy/.ssh
    echo "$1" >> /home/deploy/.ssh/authorized_keys
    chmod 700 /home/deploy/.ssh
    chmod 600 /home/deploy/.ssh/authorized_keys
    chown -R deploy:deploy /home/deploy/.ssh
fi

# 4. Create app directory
echo "Setting up application directory /opt/app..."
mkdir -p /opt/app
chown deploy:deploy /opt/app

# 5. Open firewall port
echo "Configuring firewall for port $APP_PORT..."
if systemctl is-active --quiet firewalld; then
    # Add port and reload configuration
    firewall-cmd --permanent --add-port=${APP_PORT}/tcp
    firewall-cmd --reload
    echo "Firewall rules updated successfully."
else
    echo "firewalld is not active. Skipping firewall setup."
fi

echo "---"
echo "VM Setup Complete."
echo "You can now push code via CI/CD. Ensure to define GitHub Secrets for the repository."
