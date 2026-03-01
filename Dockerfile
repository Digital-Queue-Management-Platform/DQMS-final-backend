# Multi-stage build for optimized production image
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files first (better caching)
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies for building)
RUN npm ci && \
    npx prisma generate

# Copy source code
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

# Install runtime dependencies including OpenSSL for Prisma
RUN apk add --no-cache dumb-init curl openssl openssl-dev libc6-compat

WORKDIR /app

# Copy package files and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only - skip postinstall script
# Then install prisma CLI separately for migrations
RUN npm ci --omit=dev --ignore-scripts && \
    npm install prisma@^5.22.0 && \
    npm cache clean --force

# Copy Prisma schema and generate client (this ensures engines are properly set up)
RUN npx prisma generate

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Create uploads directory and set ownership for node user
RUN mkdir -p uploads && \
    chown -R node:node /app

# Use non-root user
USER node

# Faster health check with shorter intervals
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3001) + '/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Expose port
EXPOSE 3001

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Run migrations and start server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
