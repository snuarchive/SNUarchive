# The React Router SSR server. Built from web/ as the context; runs on port
# 3000 behind Caddy in the backend's deploy/compose.yaml.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
USER node
EXPOSE 3000
# APP_ENV, API_ORIGIN, APP_ORIGIN and WEB_SESSION_SECRET come from the
# environment; the server refuses to start in production without them.
CMD ["node_modules/.bin/react-router-serve", "./build/server/index.js"]
