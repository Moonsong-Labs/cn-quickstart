# Review guidelines

What reviewers of this repository should pay attention to, by area. AI reviewers read this file on every review, and the challenger bot uses it to sort findings. Add a line here when the same review comment comes up twice.

## Severity

Rate every finding, and lead the comment with it.

- **Blocker**: wrong ledger behavior, broken authorization, leaked secrets or keys, a weakened test, or a change that breaks the quickstart flow on LocalNet.
- **Should fix**: a bug with a narrow trigger, a missing test for new behavior, or a breaking change to `quickstart/common/openapi.yaml` that nothing in the PR handles.
- **Nit**: naming, wording, or structure. Post at most three per review, and none on files the PR is deleting.

Do not comment on formatting or import order. Biome enforces both in CI.

## Showing the bug

For a blocker or a should-fix, show how the bug happens when that is clearer than describing it: the input or sequence of steps that triggers it, what happens, and what should happen instead. Where the area has a test suite, write it as a test that fails on this PR: a Daml Script in `quickstart/daml/licensing-tests`, a `bun test` case in `quickstart/cli/test`, or a Playwright step. Keep it to the few lines that reproduce the bug. Skip it for nits, and when a one-line explanation already makes the bug obvious.

## Whole repository

- American English in prose, comments, and user-facing strings.
- Every added or edited function, method, class, type, or variable has a comment describing its behavior, in that language's own syntax: `/** */` in TypeScript and Java, `#` in shell. Flag a comment that restates the name or describes old behavior.
- No credentials, tokens, or private keys in the tree. The LocalNet defaults in `quickstart/.env` are intended.

## Daml: `quickstart/daml/licensing/**`

This is where review matters most. Read every choice.

- **Authorisation.** Check `signatory`, `observer`, and `controller`. Flag a choice that a party can exercise without the other party's authority, or a new observer that exposes a contract.
- **Consuming choices.** A choice archives its contract unless it is `nonconsuming`. Flag a choice whose consuming behavior does not match what the flow needs, such as a renewal that archives the license before payment completes.
- **Upgrades.** Changing a field, a template key, or a choice signature in a released package breaks smart contract upgrades. New fields must be `Optional` and added at the end.
- **Money and time.** Amulet amounts use `Decimal`, not `Int`. Expiry comparisons use ledger time. Flag an off-by-one at an expiry boundary.
- **Token Standard.** The move from V1 to V2 (CIP-112) must keep the allocation and transfer behavior the tests assert.

## Daml tests: `quickstart/daml/licensing-tests/**`

- These are never uploaded to a ledger. They must not be a dependency of `licensing`.
- Each new choice in `licensing` needs a script that exercises both the success path and an unauthorized attempt.

## Vendored Splice: `quickstart/daml/dars/**`, `quickstart/daml/external-test-*`

Copied from upstream Splice. Only check that the versions match the Splice release in use. Do not review their contents.

## CLI: `quickstart/cli/**`

- Bun and TypeScript. External processes go through `src/lib/exec.ts`, never a raw `Bun.spawn` or `child_process`.
- Exit codes are part of the interface: `0` success, `1` failure, `2` bad usage. Flag a changed exit code that no test covers.
- New commands and flags need tests in `quickstart/cli/test/`. Snapshot fixtures change only when the output is meant to change.

## Frontend: `quickstart/frontend/**`

- React 19 and Vite. API types come from `src/openapi.d.ts`, generated from `quickstart/common/openapi.yaml`. Flag hand-written types that duplicate it.
- Once the browser extension holds the AppUser's keys, those keys never reach the frontend or the backend. The UI shows the estimated traffic cost before the user signs.

## API contract: `quickstart/common/openapi.yaml`

The contract between the backend and the frontend. A removed field, a renamed path, or a narrowed type is a breaking change. The same PR must update both sides and the integration tests.

## Integration tests: `quickstart/integration-test/**`

The Playwright suite is the gate for the TypeScript backend and for deleting the Java one. Treat any loosened assertion, added `skip`, raised timeout, or deleted test as a blocker unless the description explains it.

## Java backend: `quickstart/backend/**`, Gradle, `buildSrc`

Scheduled for deletion once the TypeScript backend passes the Playwright suite. Flag real bugs only. No refactors, style, or test suggestions.

## LocalNet and Docker: `quickstart/docker/**`, `quickstart/compose.yaml`, `quickstart/config/**`

- Image versions stay consistent with the targeted Splice release (0.8.x) and its Canton version.
- `quickstart/docker/modules/localnet/**` is LocalNet vendored from upstream Splice. Check only that a re-vendor matches the upstream release, not its contents.
- New shell scripts start with `set -euo pipefail` and quote their variables. Existing scripts keep at least `set -e`.
- Flag a port, hostname, or volume change that `README.md` or the integration tests still rely on.

## CI: `.github/**`

- Actions are pinned to a commit SHA with the version in a trailing comment.
- `permissions` stay at `contents: read` unless a job needs more, and the extra permission is set on that job only.
- A new job in `.github/workflows/ci.yml` must appear in the `needs` of `ci-ok`. Otherwise its failure never blocks a merge.
- `.github/workflows/pr-description.yml` is the one required check outside `ci-ok`, because it reruns on every description edit. A change to `.github/scripts/pr-description.ts` that loosens a rule needs a reason in the description.
- Pull-request runs cancel superseded runs. Runs on `msl` never do.
