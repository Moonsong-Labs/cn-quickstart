# The existing DPM installer targets amd64; generated JS/TS works on either runtime architecture.
FROM --platform=linux/amd64 eclipse-temurin:21-jdk-jammy AS bindings
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY .github/actions/setup/install-dpm/install-dpm.sh /tmp/install-dpm.sh
# Reuse CI's pinned SDK and checksum verification without GitHub environment files.
RUN RUNNER_TEMP=/opt GITHUB_PATH=/dev/null GITHUB_ENV=/dev/null bash /tmp/install-dpm.sh
ENV DPM_HOME=/opt/dpm
ENV DPM_SDK_VERSION=3.5.2
ENV PATH="/opt/dpm/bin:${PATH}"
WORKDIR /app/quickstart/daml/licensing
COPY quickstart/daml/dars/ ../dars/
COPY quickstart/daml/licensing/daml.yaml ./
COPY quickstart/daml/licensing/daml/ ./daml/
RUN dpm build && dpm codegen-js

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
COPY --from=bindings /app/quickstart/backend-ts/build/generated-daml-bindings ./quickstart/backend-ts/build/generated-daml-bindings
COPY quickstart/backend-ts/scripts/link-daml-bindings.ts ./quickstart/backend-ts/scripts/link-daml-bindings.ts
WORKDIR /app/quickstart/backend-ts
RUN bun --no-env-file scripts/link-daml-bindings.ts && bun run build:bundle

FROM oven/bun:1.3.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8081
COPY --from=build --chown=bun:bun /app/quickstart/backend-ts/dist ./dist
USER bun
EXPOSE 8081
CMD ["bun", "dist/server.js"]
