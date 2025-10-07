# Digital Queue Platform - Backend

## Setup

1. Install dependencies:
\`\`\`bash
npm install
\`\`\`

2. Configure environment variables:
\`\`\`bash
cp .env.example .env
# Edit .env with your PostgreSQL connection string
\`\`\`

3. Run Prisma migrations:
\`\`\`bash
npm run prisma:migrate
\`\`\`

4. Generate Prisma Client:
\`\`\`bash
npm run prisma:generate
\`\`\`

5. Start development server:
\`\`\`bash
npm run dev
\`\`\`

## API Endpoints

### Customer
- POST `/api/customer/register` - Register and get token
- GET `/api/customer/token/:tokenId` - Get token status

### Officer
- POST `/api/officer/login` - Officer login
- POST `/api/officer/next-token` - Get next token
- POST `/api/officer/complete-service` - Complete service
- POST `/api/officer/status` - Update status
- GET `/api/officer/stats/:officerId` - Get officer stats

### Queue
- GET `/api/queue/outlet/:outletId` - Get queue status
- GET `/api/queue/outlets` - Get all outlets

### Feedback
- POST `/api/feedback/submit` - Submit feedback

### Admin
- GET `/api/admin/analytics` - Get analytics
- GET `/api/admin/alerts` - Get alerts
- PATCH `/api/admin/alerts/:alertId/read` - Mark alert as read
- GET `/api/admin/dashboard/realtime` - Real-time dashboard

### Document
- POST `/api/document/upload` - Upload document
- GET `/api/document/:relatedEntity` - Get documents

## WebSocket

Connect to `ws://localhost:3001` for real-time updates.

Events:
- `NEW_TOKEN` - New token created
- `TOKEN_CALLED` - Token called to counter
- `TOKEN_COMPLETED` - Service completed
- `NEGATIVE_FEEDBACK` - Negative feedback received
