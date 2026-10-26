FROM oven/bun:1.3.3-slim AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY quickstart/backend-ts/package.json ./quickstart/backend-ts/package.json
COPY quickstart/cli/package.json ./quickstart/cli/package.json
COPY quickstart/frontend/package.json ./quickstart/frontend/package.json
COPY quickstart/integration-test/package.json ./quickstart/integration-test/package.json
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY quickstart/backend-ts/tsconfig.json ./quickstart/backend-ts/tsconfig.json
COPY quickstart/backend-ts/src ./quickstart/backend-ts/src
WORKDIR /app/quickstart/backend-ts
RUN bun run build

FROM oven/bun:1.3.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8081
COPY --from=build --chown=bun:bun /app/quickstart/backend-ts/dist ./dist
USER bun
EXPOSE 8081
CMD ["bun", "dist/server.js"]
