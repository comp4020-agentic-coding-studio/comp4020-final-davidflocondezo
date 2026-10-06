# syntax = docker/dockerfile:1

# Next.js standalone build, three stages: install, build, then a minimal
# runtime image. Debian-slim (not Alpine) because better-sqlite3's prebuilt
# native binding targets glibc, not musl.

FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-slim AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/README.md ./README.md

# better-sqlite3's native binding isn't picked up by Next's standalone
# tracing (it's loaded via a runtime require, not a static import), so it's
# copied in explicitly alongside the rest of standalone's node_modules.
COPY --from=deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

EXPOSE 8080
CMD ["node", "server.js"]
