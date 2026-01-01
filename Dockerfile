# Build stage
FROM node:20-alpine AS builder

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (--legacy-peer-deps for react-diff-viewer-continued compatibility)
RUN npm ci --legacy-peer-deps

# Copy source files
COPY . .

# Build the Next.js app
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built assets from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Create data directory for SQLite database
RUN mkdir -p /data && chown nextjs:nodejs /data

# Set ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

# Expose port
EXPOSE 3000

# Environment variables
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_PATH="/data/data.db"

# Start the server
CMD ["node", "server.js"]
