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

With the Ledger running, create the backend configuration on first setup:

```bash
cd quickstart/backend-ts
cp .env.example .env
```

Set `LEDGER_API_URL`, `LEDGER_API_USER_ID`, and `APP_PROVIDER_PARTY` in `.env` for your
participant and onboarded App Provider. For shared-secret mode, set
`APP_PROVIDER_BACKEND_USER_TOKEN` to the onboarding token. For OAuth2, set
`AUTH_MODE=oauth2` and fill in the issuer and backend client credentials listed in the example.

Generate the bindings and start the backend with automatic restarts:

```bash
bun run codegen:daml
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

Run these commands from `quickstart/backend-ts`. Regenerate bindings after changing
contracts before running tests or type checks:

| Command | Purpose |
| --- | --- |
| `bun run codegen:daml` | Build licensing and generate Daml JS/TS bindings (requires DPM and Java). |
| `bun run build` | Generate bindings, check types and bundle the server into `dist/`. |
| `bun run start:prod` | Run the built server with Bun. |
| `bun run test` | Run backend tests. |
| `bun run typecheck` | Check TypeScript without generating files. |
| `bun run lint` | Check lint rules, formatting, and imports with Biome. |
| `bun run lint:fix` | Apply Biome's safe fixes. |
| `bun run format` | Format files. |
| `bun run format:check` | Check formatting without modifying files. |

## Docker

From `quickstart/backend-ts`, build the image using the repository root as context:

```bash
docker build -f Dockerfile -t cn-quickstart-backend ../..
docker run --rm --env-file .env -p 127.0.0.1:8081:8081 cn-quickstart-backend
```

Use a Ledger URL (and OAuth issuer, if applicable) reachable from the container.
On Docker Desktop, use `host.docker.internal` for services published on the host.

The image runs the bundled backend as an unprivileged user. Override the listening
port with `-e PORT=<port>` and adjust the container port mapping accordingly.

## Integration tests

With Docker running, execute `bun run test:integration` from `quickstart/backend-ts`.
It stops the current LocalNet, starts a fresh OAuth2 LocalNet, runs the ledger tests,
and cleans up afterward. Existing development volumes are preserved.
