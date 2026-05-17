FROM node:22.13-alpine AS build
WORKDIR /app

COPY package.json bun.lock* ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm install -g bun@1.2.4 \
  && (bun install --frozen-lockfile || bun install)

COPY . .
RUN npm --workspace @borodutch-tools/frontend run build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
