# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy root monorepo configuration
COPY package.json turbo.json package-lock.json* ./

# Copy shared packages and the api app
COPY packages/types ./packages/types
COPY apps/api ./apps/api

# Install dependencies (workspaces will automatically link @stride/types)
RUN npm ci

# Build the types first, then build the API
RUN npx turbo run build --filter=@stride/types --filter=@stride/api

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts and node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/types ./packages/types
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
