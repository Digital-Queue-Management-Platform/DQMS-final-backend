# DQMP Backend API

The core processing engine for the **Digital Queue Management Platform**. This enterprise-grade API manages real-time token lifecycles, role-based access control and complex integrations with Sri Lanka Telecom infrastructure.

---

## Tech Stack

- **Runtime:** Node.js (v18+)
- **Language:** TypeScript
- **Web Framework:** Express.js
- **ORM:** Prisma
- **Real-time:** WebSockets (`ws`)
- **Logging:** Pino
- **Security:** JWT Authentication & Bcrypt hashing

## Core Modules

- **`src/controllers`**: Request handling and business logic orchestration.
- **`src/services`**: Specialized logic for SLT integrations (SMS, Billing, Email).
- **`src/routes`**: API endpoint definitions.
- **`src/middleware`**: Authentication, logging, and error handling.
- **`prisma/`**: Database schema and migration management.

## Getting Started

### 1. Prerequisites
- Node.js & npm
- PostgreSQL database

### 2. Installation
```bash
# From the backend directory
npm install
```

### 3. Environment Setup
Create a `.env` file based on the template:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/dqmp?schema=public"
JWT_SECRET="your_secure_random_hash"
PORT=5000
```

### 4. Database Initialization
```bash
npx prisma generate
npx prisma migrate dev
```

### 5. Running the Application
```bash
# Development mode
npm run dev

# Production build
npm run build
npm start
```

## Key Scripts

| Script | Purpose |
| :--- | :--- |
| `npm run dev` | Starts server with `tsx watch` for rapid development. |
| `npm run prisma:migrate` | Synchronizes database with schema changes. |
| `npm run seed:outlets` | Populates the database with initial SLT outlet data. |
| `npm run test:slt-sms` | Validates the SLT SMS gateway connectivity. |

---

> [!NOTE]  
> This backend is designed to handle high concurrency, specifically optimized for multi-outlet environments across Sri Lanka.
