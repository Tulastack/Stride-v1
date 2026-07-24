# Build stage
FROM node:22-slim AS builder
WORKDIR /app

# Copy every workspace manifest first (npm ci validates the lockfile against
# ALL workspaces declared by the root package.json globs), then the source.
COPY package.json turbo.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
COPY apps/mobile/package.json ./apps/mobile/
COPY packages/types/package.json ./packages/types/
COPY packages/content/package.json ./packages/content/
COPY packages/design-tokens/package.json ./packages/design-tokens/

RUN npm ci

# Copy shared packages and the api app sources
COPY packages/types ./packages/types
COPY apps/api ./apps/api

# Build the types first, then build the API
RUN npx turbo run build --filter=@stride/types --filter=@stride/api

# Prune dev dependencies for the runtime image (keeps workspace links intact)
RUN npm prune --omit=dev

# Production stage
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts and production-only node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

# Run as the unprivileged node user (port 3000 needs no root)
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
