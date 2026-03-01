# Digital Queue Management System - Backend

[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.x-lightgrey.svg)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-5.x-2D3748.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15.x-336791.svg)](https://www.postgresql.org/)

A robust RESTful API backend for the Digital Queue Management System, designed for banks and service centers to efficiently manage customer queues, officer assignments, and real-time operations.

## Features

### Authentication & Authorization

- **Multi-role authentication** (Admin, Manager, Officer)
- **JWT token-based** security with role-based access control
- **Secure password hashing** using bcrypt
- **Session management** with token expiration

### User Management

- **Customer registration** with mobile verification
- **Officer management** with performance tracking
- **Admin dashboard** with comprehensive system oversight
- **Manager hierarchy** for regional control

### Queue Management

- **Real-time token generation** with automatic numbering
- **Dynamic queue status** tracking (waiting, in-service, completed)
- **Service type categorization** with customizable services
- **Multi-outlet support** with branch-specific queues
- **Officer assignment** and workload distribution

### Real-time Communication

- **WebSocket integration** for live updates
- **Event-driven architecture** for instant notifications
- **Real-time dashboard** updates for all stakeholders

### Analytics & Reporting

- **Performance metrics** for officers and branches
- **Customer satisfaction** tracking with feedback system
- **Wait time analysis** and optimization insights
- **Service efficiency** reporting

### Notification System

- **Email notifications** for important events
- **Alert management** for negative feedback
- **Automated reporting** to managers

## Architecture

### Database Schema

```
├── Customer (Customer registration & profiles)
├── Token (Queue tokens & service requests)
├── Officer (Staff management & performance)
├── Outlet (Branch/location management)
├── Region (Geographic organization)
├── Service (Service type definitions)
├── Feedback (Customer satisfaction tracking)
├── Alert (System notifications)
├── Document (File management)
└── BreakLog (Officer break tracking)
```

### API Structure

```
src/
├── server.ts              # Main application entry point
├── routes/                # API route definitions
│   ├── admin.routes.ts    # Admin management endpoints
│   ├── customer.routes.ts # Customer registration & tokens
│   ├── officer.routes.ts  # Officer dashboard & operations
│   ├── manager.routes.ts  # Manager oversight & controls
│   ├── queue.routes.ts    # Queue status & management
│   ├── feedback.routes.ts # Customer feedback system
│   ├── document.routes.ts # File upload & management
│   └── ip-speaker.routes.ts # IP speaker integration
├── services/              # Business logic & external services
│   └── emailService.ts    # Email notification service
└── utils/                 # Utility functions
    └── passwordGenerator.ts # Secure password generation
```

## Getting Started

### Prerequisites

- **Node.js 18.x** or higher
- **PostgreSQL 15.x** or higher
- **npm** or **yarn** package manager

### 1. Clone & Install

```bash
git clone https://github.com/Digital-Queue-Management-Platform/DQMS-final-backend.git
cd DQMS-final-backend
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory:

```env
# Database Connection
DATABASE_URL="postgresql://username:password@localhost:5432/dqms"

# Server Configuration
PORT=3001
FRONTEND_ORIGIN="http://localhost:3000,http://localhost:5173"

# JWT Configuration
JWT_SECRET="your_super_secure_jwt_secret_key"
JWT_EXPIRES="8h"

# Email Configuration (SMTP)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
SMTP_FROM="DQMS System <your-email@gmail.com>"

# System Configuration
LONG_WAIT_MINUTES=10
```

### 3. Database Setup

```bash
# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# (Optional) Seed sample data
npm run seed:outlets
```

### 4. Start Development Server

```bash
npm run dev
```

The API will be available at `http://localhost:3001`

## API Documentation

### Base URL

- **Development**: `http://localhost:3001/api`
- **Production**: `https://dpdlab1.slt.lk:8447/dqms-api/api`

### Authentication

Most endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

### Core Endpoints

#### Customer Management

```http
POST   /api/customer/register              # Register new customer & get token
POST   /api/customer/register/:outletId    # Register for specific outlet
GET    /api/customer/token/:tokenId        # Get token status
POST   /api/customer/sms/send              # Send SMS verification
POST   /api/customer/sms/verify            # Verify SMS code
```

#### Officer Operations

```http
POST   /api/officer/login                  # Officer authentication
POST   /api/officer/logout                 # Officer logout
GET    /api/officer/profile                # Get officer profile
POST   /api/officer/next-token             # Assign next token to officer
POST   /api/officer/call-token             # Call token to counter
POST   /api/officer/complete-service       # Mark service as completed
POST   /api/officer/skip-token             # Skip current token
POST   /api/officer/status                 # Update officer status
POST   /api/officer/break/start            # Start break
POST   /api/officer/break/end              # End break
GET    /api/officer/stats/:officerId       # Get performance statistics
GET    /api/officer/summary/:officerId     # Get daily summary
```

#### Queue Management

```http
GET    /api/queue/outlet/:outletId         # Get queue status for outlet
GET    /api/queue/outlets                  # Get all active outlets
GET    /api/queue/regions                  # Get all regions
GET    /api/queue/services                 # Get all services
POST   /api/queue/services                 # Create new service
PATCH  /api/queue/services/:id             # Update service
DELETE /api/queue/services/:id             # Delete service
POST   /api/queue/outlets                  # Create new outlet
PATCH  /api/queue/outlets/:id              # Update outlet
DELETE /api/queue/outlets/:id              # Deactivate outlet
```

#### Admin Dashboard

```http
GET    /api/admin/analytics                # Get system analytics
GET    /api/admin/dashboard/realtime       # Real-time dashboard data
GET    /api/admin/alerts                   # Get system alerts
PATCH  /api/admin/alerts/:id/read          # Mark alert as read
GET    /api/admin/officers                 # Get all officers
POST   /api/admin/officers                 # Create new officer
PATCH  /api/admin/officers/:id             # Update officer
DELETE /api/admin/officers/:id             # Delete officer
GET    /api/admin/regions                  # Get regions with statistics
```

#### Manager Operations

```http
POST   /api/manager/login                  # Manager authentication
GET    /api/manager/branches               # Get managed branches
GET    /api/manager/officers               # Get region officers
POST   /api/manager/officers               # Register new officer
GET    /api/manager/analytics              # Get region analytics
GET    /api/manager/qr-codes               # Get QR codes for branches
POST   /api/manager/qr-codes/generate      # Generate new QR codes
```

#### Feedback System

```http
POST   /api/feedback/submit                # Submit customer feedback
GET    /api/feedback/outlet/:outletId      # Get outlet feedback
GET    /api/feedback/officer/:officerId    # Get officer feedback
```

#### Document Management

```http
POST   /api/document/upload                # Upload documents
GET    /api/document/:relatedEntity        # Get entity documents
DELETE /api/document/:documentId           # Delete document
```

### WebSocket Events

Connect to the WebSocket server for real-time updates:

```javascript
const ws = new WebSocket("ws://localhost:3001");

// Listen for events
ws.on("NEW_TOKEN", (data) => {
  // New customer registered
});

ws.on("TOKEN_CALLED", (data) => {
  // Token called to counter
});

ws.on("TOKEN_COMPLETED", (data) => {
  // Service completed
});

ws.on("OFFICER_STATUS_CHANGED", (data) => {
  // Officer status updated
});

ws.on("NEGATIVE_FEEDBACK", (data) => {
  // Negative feedback received
});
```

## Development

### Available Scripts

```bash
npm run dev              # Start development server with hot reload
npm run build            # Build for production
npm run start            # Start production server
npm run build:prod       # Build with database migrations
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run database migrations
npm run prisma:studio    # Open Prisma Studio
npm run seed:outlets     # Seed sample outlet data
npm run test:email       # Test email configuration
```

### Database Management

```bash
# View database in browser
npm run prisma:studio

# Create new migration
npx prisma migrate dev --name migration-name

# Reset database (development only)
npx prisma migrate reset

# Deploy migrations to production
npm run prisma:migrate:prod
```

### Utility Scripts

```bash
# Test email functionality
npm run test:email

# Generate QR codes for outlets
tsx scripts/generateQRCodes.ts

# Create test tokens with different languages
tsx scripts/createTestTokensWithLanguages.ts

# Check manager configurations
tsx scripts/checkManagers.ts

# Debug system state
tsx scripts/debugState.ts
```

## Deployment

This project uses a fully automated CI/CD pipeline via GitHub Actions to deploy to a Rocky Linux 9 virtual machine.

### CI/CD Pipeline Overview

The `.github/workflows/deploy.yml` pipeline runs automatically on pushes to the `main` branch. It performs the following stages:

1. **Lint & Verify**: Checks out the code and prepares the environment. (Tests are currently skipped as no testing framework is integrated).
2. **Build & Containerize**: Builds an optimized production Docker image and pushes it to the GitHub Container Registry (GHCR) using both `latest` and a short commit SHA tag.
3. **Deploy & Verify**: Connects to the Rocky Linux VM via SSH, transfers `docker-compose.prod.yml`, populates the `.env` file via GitHub Secrets, pulls the new image by its exact SHA, and performs a rolling restart. Finally, it uses Docker's built-in healthchecks to verify successful deployment.

### Required Secrets

The pipeline requires the following secrets to be configured in GitHub at **Settings > Secrets and variables > Actions**:

- `VM_HOST`: The IP address or domain of the Rocky Linux 9 VM.
- `VM_SSH_PORT`: Custom SSH port for the VM (Optional, defaults to 22).
- `VM_SSH_KEY`: The private SSH key for the `deploy` user.
- `APP_ENV`: The complete contents of your `.env` file containing all production configurations (Database, JWT, SMTP, Twilio, etc.).

### Initializing the VM (First Time Setup)

To prepare a fresh Rocky Linux 9 VM for deployment:

1. Locate the `scripts/setup-vm.sh` script.
2. Transfer it to your VM and run it as `root` (or with sudo), passing your CI/CD system's SSH public key as an argument:
   ```bash
   sudo ./setup-vm.sh "ssh-ed25519 AAAAC3NzaC... ci-cd-key"
   ```
   This idempotent script installs Docker, creates the `deploy` user, opens firewall port 3001, and establishes the `/opt/app` directory.

### Triggering a Deployment

Deployments are triggered automatically whenever code is pushed or merged into the `main` branch. You can track progress in the **Actions** tab of the GitHub repository.

### Rollback Strategy

If a deployment fails or introduces a bug, you can efficiently roll back by reverting the commit on the `main` branch:

1. Run `git revert <commit-hash>`.
2. Push the reverted commit to `main`.
3. The CI/CD pipeline will automatically build and deploy the reverted, stable state.

Alternatively, you can manually SSH into the VM, edit the `DOCKER_IMAGE` variable in `/opt/app/.env` to a previously working SHA tag, and run `docker compose up -d`.

## Monitoring & Logging

### Health Check

```http
GET /api/health
```

### Error Handling

The API uses consistent error response format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": "Additional error details"
}
```

### Performance Monitoring

- Database query optimization with Prisma
- Connection pooling for PostgreSQL
- Request logging and error tracking
- WebSocket connection monitoring

## Testing

### Manual Testing Scripts

```bash
# Test all endpoints
tsx scripts/testSummaryEndpoints.ts

# Test password reset flow
tsx scripts/testPasswordReset.ts

# Test manager name display
tsx scripts/testManagerNameDisplay.ts

# Create test alerts
tsx scripts/createTestAlerts.ts
```

### Database Testing

```bash
# Check system state
tsx scripts/debugState.ts

# Delete all test data
tsx scripts/deleteAll.ts
```

## Security Features

- **JWT Authentication** with configurable expiration
- **Password Hashing** using bcrypt with salt rounds
- **CORS Protection** with configurable origins
- **Input Validation** and sanitization
- **SQL Injection Protection** via Prisma ORM
- **Rate Limiting** on sensitive endpoints
- **Secure Headers** with Express middleware

## Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Development Guidelines

- Follow **TypeScript** best practices
- Use **Prisma** for all database operations
- Implement **proper error handling**
- Add **JSDoc comments** for complex functions
- Follow **RESTful API** conventions
