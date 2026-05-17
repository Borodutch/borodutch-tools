FROM oven/bun:1.2.4 AS build
WORKDIR /app

COPY package.json bun.lock* ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN bun install --frozen-lockfile || bun install

COPY . .
RUN bun run build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
