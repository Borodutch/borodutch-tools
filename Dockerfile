# Easypanel passes every service env var as a build arg. Only the public VITE_* values are
# declared below, so secrets (BORO_CLAIM_SENDER_PRIVATE_KEY, DATABASE_URL) are runtime-only and
# never land in the image (Nixpacks wrote all of them into the image's ENV).
FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS deps
COPY --from=oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked bun install --frozen-lockfile

# Each app builds from its own sources, so a backend change doesn't rerun the frontend build and vice versa
FROM deps AS frontend
COPY apps/frontend apps/frontend
ARG VITE_BASE_MAINNET_BORO_ADDRESS
ARG VITE_BORO_LOCK_ADDRESS
ARG VITE_BASE_MAINNET_RPC_URL
ARG VITE_BORO_LOCK_MATURED_PAGE_SIZE
RUN bun --filter @borodutch-tools/frontend build

FROM deps AS backend
COPY apps/backend apps/backend
RUN bun --filter @borodutch-tools/backend build

# Runtime: production dependencies only (vite/vitest/postcss/tailwind and their trees stay out of the image)
FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
COPY --from=oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/frontend/package.json apps/frontend/
COPY apps/backend/package.json apps/backend/
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked bun install --frozen-lockfile --production
# From the backend stage, so its typecheck still gates the image
COPY --from=backend /app/apps/backend apps/backend
COPY --from=frontend /app/apps/frontend/dist apps/frontend/dist

ENV NODE_ENV=production
CMD ["bun", "run", "start"]
