# Easypanel passes every service env var as a build arg. Only the public VITE_* values are
# declared below, so secrets (BORO_CLAIM_SENDER_PRIVATE_KEY, DATABASE_URL) are runtime-only and
# never land in the image (Nixpacks wrote all of them into the image's ENV).
FROM node:22.23.4-bookworm-slim
COPY --from=oven/bun:1.4.4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/
RUN bun install --frozen-lockfile

COPY . .
ARG VITE_BASE_MAINNET_BORO_ADDRESS
ARG VITE_BORO_LOCK_ADDRESS
ARG VITE_BASE_MAINNET_RPC_URL
ARG VITE_BORO_LOCK_MATURED_PAGE_SIZE
RUN bun run build

ENV NODE_ENV=production
CMD ["bun", "run", "start"]
