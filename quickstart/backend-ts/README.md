# TypeScript backend

TypeScript backend for the CN Quickstart licensing application, targeting Bun
and Elysia. Currently under development.

The backend is organized around application features, shared HTTP infrastructure,
and integrations with Canton Ledger API, PQS, and the Token Registry.

Development uses the repository's shared TypeScript and Biome configuration.
The existing [OpenAPI contract](../common/openapi.yaml) guides compatibility with
the frontend during the port from Java.

## Local development

Use Bun 1.3.3, as pinned by the repository. Install dependencies from the repository
root:

```bash
bun install --frozen-lockfile
```

Start the backend with automatic restarts when source files change:

```bash
cd quickstart/backend-ts
bun run dev
```

To start without watching files:

```bash
bun run start
```

The server defaults to port `8081`. Set `PORT` to override it:

```bash
PORT=8082 bun run start
```

Stop either command with `Ctrl+C`.

## Build and checks

Run these commands from `quickstart/backend-ts`:

| Command                | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `bun run build`        | Check types and bundle the server into `dist/`.       |
| `bun run start:prod`   | Run the built server with Bun.                        |
| `bun run test`         | Run backend tests.                                    |
| `bun run typecheck`    | Check TypeScript without generating files.            |
| `bun run lint`         | Check lint rules, formatting, and imports with Biome. |
| `bun run lint:fix`     | Apply Biome's safe fixes.                             |
| `bun run format`       | Format files.                                         |
| `bun run format:check` | Check formatting without modifying files.             |

## Docker

From `quickstart/backend-ts`, build the image using the repository root as context:

```bash
docker build -f Dockerfile -t cn-quickstart-backend ../..
docker run --rm -p 127.0.0.1:8081:8081 cn-quickstart-backend
```

The image runs the bundled backend as an unprivileged user. Override the listening
port with `-e PORT=<port>` and adjust the container port mapping accordingly.
