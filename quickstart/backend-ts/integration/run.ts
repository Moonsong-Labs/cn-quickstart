import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { composeArgs, composeEnv } from '../../cli/src/lib/compose';
import { readProject } from '../../cli/src/lib/project';

/** Bounds how long Compose waits for LocalNet services to become ready. */
const STARTUP_TIMEOUT_SECONDS = 600;
/** Gives containers time to stop gracefully during teardown. */
const SHUTDOWN_TIMEOUT_SECONDS = 10;
/** Converts the command budget in minutes to the milliseconds expected by setTimeout. */
const MILLISECONDS_PER_MINUTE = 60_000;
/** Limits commands that do not supply their own deadline. */
const COMMAND_TIMEOUT_MS = 15 * MILLISECONDS_PER_MINUTE;
/** Locates the backend package for binding generation regardless of the working directory. */
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Provides the default working directory for Quickstart commands. */
const quickstart = resolve(backend, '..');
/** Identifies the checkout mounted in the test container and its pinned Bun version. */
const repository = resolve(quickstart, '..');

/** Retains mount paths so the runner can replace onboarding DAR bindings. */
interface Mount {
  type: string;
  source: string;
  target: string;
}
/** Describes the Compose service fields adjusted for an isolated LocalNet. */
interface Service {
  container_name?: string;
  ports?: unknown[];
  profiles?: string[];
  environment?: Record<string, string>;
  volumes?: Mount[];
  depends_on?: Record<string, unknown>;
  image?: string;
}
/** Holds the rendered Compose project configuration used by the integration run. */
interface Compose {
  name?: string;
  services: Record<string, Service>;
  volumes: Record<string, Record<string, unknown>>;
  networks: Record<string, Record<string, unknown>>;
}

/** Passes selected host settings to commands so local application credentials stay out of Compose interpolation. */
const hostEnv: Record<string, string> = {};
for (const name of [
  'PATH',
  'HOME',
  'USER',
  'TMPDIR',
  'LANG',
  'JAVA_HOME',
  'DPM_HOME',
  'DPM_SDK_VERSION',
  'DOCKER_HOST',
  'DOCKER_CONFIG',
  'DOCKER_CONTEXT',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
]) {
  const value = process.env[name];
  if (value !== undefined) hostEnv[name] = value;
}
/** Allows teardown commands to run after an interruption. */
let cleaningUp = false;
/** Records cancellation between commands so the runner can proceed to cleanup. */
let interrupted = false;

/** Marks a completed command or integration run as successful. */
const EXIT_CODE_SUCCESS = 0;
/** Reports a failure when no more specific exit code is available. */
const EXIT_CODE_FAILURE = 1;
/** Reports cancellation using the conventional Ctrl+C exit code. */
export const EXIT_CODE_INTERRUPTED = 130;
/** Probes whether a process group exists without sending a terminating signal. */
const PROCESS_EXISTS_SIGNAL = 0;

/** Allows child processes to exit after SIGTERM before escalation to SIGKILL. */
const TERMINATION_GRACE_MS = 2_000;
/** Bounds the wait for the process group to disappear after SIGKILL. */
const KILL_WAIT_MS = 2_000;
/** Spaces process group existence checks while waiting for termination. */
const GROUP_POLL_INTERVAL_MS = 25;

/** Carries a failed command exit code through cleanup to the integration runner exit status. */
export class CommandError extends Error {
  /** Creates an error that preserves a command's exit code for the runner. */
  constructor(
    readonly code: number,
    command: string,
  ) {
    super(`${command} failed (exit ${code})`);
  }
}

/** Sends a signal to a child process group, treating a missing group as already stopped. */
function signalGroup(pid: number, signal: NodeJS.Signals | typeof PROCESS_EXISTS_SIGNAL): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    // A denied existence probe still means the group may exist; keep waiting.
    if (signal === PROCESS_EXISTS_SIGNAL && code === 'EPERM') return true;
    throw error;
  }
}

/** Polls until a process group exits or the supplied timeout expires. */
async function waitForGroup(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (signalGroup(pid, PROCESS_EXISTS_SIGNAL)) {
    if (Date.now() >= deadline) return false;
    await delay(GROUP_POLL_INTERVAL_MS);
  }
  return true;
}

/** Stops a process group with SIGTERM, then escalates to SIGKILL if it exceeds the grace period. */
async function terminateGroup(pid: number, graceMs: number): Promise<void> {
  if (!signalGroup(pid, 'SIGTERM')) return;
  if (await waitForGroup(pid, graceMs)) return;
  signalGroup(pid, 'SIGKILL');
  if (!(await waitForGroup(pid, KILL_WAIT_MS)))
    throw new Error('Command process group did not terminate');
}

/**
 * Runs a command in its own process group, using allowlisted host settings by default.
 * Timeout or cancellation terminates the group; optional capture returns stdout.
 */
export async function run(
  command: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    signal?: AbortSignal;
    capture?: boolean;
    graceMs?: number;
  } = {},
): Promise<string> {
  if ((interrupted && !cleaningUp) || options.signal?.aborted)
    throw new CommandError(EXIT_CODE_INTERRUPTED, command[0]);
  if (process.platform === 'win32')
    throw new Error('LocalNet integration commands require macOS, Linux, or WSL');
  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd ?? quickstart,
    env: options.env ?? hostEnv,
    // The child leads its own group, so signals cannot reach the integration runner.
    detached: true,
    stdio: ['ignore', options.capture ? 'pipe' : 'inherit', options.capture ? 'pipe' : 'inherit'],
  });
  const pid = child.pid;
  let output = '';
  let timedOut = false;
  let commandInterrupted = false;
  let termination: Promise<void> | undefined;
  /** Shares one termination attempt between cancellation and timeout handlers. */
  function stopGroup() {
    if (pid === undefined) return;
    termination ??= terminateGroup(pid, options.graceMs ?? TERMINATION_GRACE_MS);
    // The result awaits this rejection after the child closes.
    void termination.catch(() => {});
  }
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });
  // Captured output can contain credentials. Failures report only command name and status.
  child.stderr?.on('data', () => {});
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  /** Records command cancellation and starts stopping its process group. */
  function interruptCommand() {
    commandInterrupted = true;
    stopGroup();
  }
  process.on('SIGINT', interruptCommand);
  process.on('SIGTERM', interruptCommand);
  options.signal?.addEventListener('abort', interruptCommand, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    stopGroup();
  }, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
  try {
    const code = await closed;
    if (termination) await termination;
    if (commandInterrupted) throw new CommandError(EXIT_CODE_INTERRUPTED, command[0]);
    if (timedOut) throw new Error(`${command[0]} exceeded its timeout`);
    if (code !== EXIT_CODE_SUCCESS) throw new CommandError(code ?? EXIT_CODE_FAILURE, command[0]);
    return output;
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', interruptCommand);
    process.off('SIGTERM', interruptCommand);
    options.signal?.removeEventListener('abort', interruptCommand);
  }
}

/**
 * Provisions an isolated OAuth LocalNet, runs ledger tests, and cleans up its resources.
 * Attempts to save logs on failure. Signals exit with code 130; cleanup failures retain
 * temporary configuration for manual recovery.
 */
export async function runIntegration(
  checkImage?: (project: string, credentialsFile: string) => Promise<void>,
) {
  const project = `qs-ledger-it-${randomUUID().slice(0, 8)}`;
  const testContainer = `${project}-tests`;
  const directory = await mkdtemp(join(tmpdir(), `${project}-`));
  const composeFile = join(directory, 'compose.json');
  const services = [
    'postgres',
    'pqs-app-provider',
    'keycloak',
    'nginx-keycloak',
    'canton',
    'splice',
    'splice-onboarding',
  ];

  let configured = false;
  let exitCode = EXIT_CODE_SUCCESS;

  /** Targets the temporary Compose file and project created for this run. */
  const compose = (...args: string[]) => [
    'docker',
    'compose',
    '-p',
    project,
    '-f',
    composeFile,
    ...args,
  ];
  /** Records the signal so the runner can skip remaining work and clean up. */
  function interrupt() {
    interrupted = true;
  }
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);

  try {
    console.info('Checking Docker and stopping the current Quickstart LocalNet...');
    await run(['docker', 'info'], { capture: true });
    if (existsSync(join(quickstart, '.env.local'))) await run(['make', 'stop']);
    if (interrupted) throw new CommandError(EXIT_CODE_INTERRUPTED, 'Integration run');

    console.info('Building licensing DAR and regenerating bindings...');
    await run([process.execPath, 'run', '--cwd', backend, 'codegen:daml']);
    if (interrupted) throw new CommandError(EXIT_CODE_INTERRUPTED, 'Integration run');

    /** Selects the test network without inheriting the developer's Compose settings. */
    const renderEnv = { ...hostEnv, DOCKER_NETWORK: project };
    /** Uses the same files and profiles as the CLI with the integration fixture as its overlay. */
    const localnet = readProject(quickstart, renderEnv, join(backend, 'integration/localnet.env'));
    const configuration = JSON.parse(
      await run(
        ['docker', 'compose', ...composeArgs(localnet.settings), 'config', '--format', 'json'],
        {
          capture: true,
          env: composeEnv(renderEnv, localnet),
        },
      ),
    ) as Compose;
    const backendEnvironment = configuration.services['backend-service'].environment;
    if (!backendEnvironment) throw new Error('Missing service configuration in rendered Compose');

    configuration.name = project;
    configuration.services = Object.fromEntries(
      services.map((name) => {
        const service = configuration.services[name];
        if (!service) throw new Error(`Missing LocalNet service: ${name}`);
        delete service.container_name;
        delete service.ports;
        delete service.profiles;
        if (service.depends_on) {
          service.depends_on = Object.fromEntries(
            Object.entries(service.depends_on).filter(([dependency]) =>
              services.includes(dependency),
            ),
          );
        }
        return [name, service];
      }),
    );
    for (const [name, volume] of Object.entries(configuration.volumes))
      volume.name = `${project}-${name}`;
    for (const [name, network] of Object.entries(configuration.networks))
      network.name = `${project}-${name}`;

    const dars = join(directory, 'dars');
    await mkdir(dars);
    await copyFile(
      join(quickstart, 'daml/licensing/.daml/dist/quickstart-licensing-0.0.1.dar'),
      join(dars, 'quickstart-licensing-0.0.1.dar'),
    );
    const onboarding = configuration.services['splice-onboarding'];
    onboarding.image = 'cn-quickstart-ledger-onboarding:local';
    onboarding.volumes = onboarding.volumes?.filter(
      ({ target }) =>
        !target.startsWith('/canton/dars') &&
        target !== '/integration-test' &&
        target !== '/app/scripts/on/integration-tests-environment-init.sh',
    );
    onboarding.volumes?.push({ type: 'bind', source: dars, target: '/canton/dars' });
    await writeFile(composeFile, JSON.stringify(configuration), { mode: 0o600 });
    configured = true;

    console.info(`Starting clean OAuth LocalNet (${project})...`);
    await run(
      compose('up', '-d', '--build', '--wait', '--wait-timeout', String(STARTUP_TIMEOUT_SECONDS)),
    );
    if (interrupted) throw new CommandError(EXIT_CODE_INTERRUPTED, 'Integration run');

    const onboardingScript = await run(
      compose(
        'exec',
        '-T',
        'splice-onboarding',
        'cat',
        '/onboarding/backend-service/on/backend-service.sh',
      ),
      { capture: true },
    );
    const party = onboardingScript
      .match(/^\s*export APP_PROVIDER_PARTY=(.+)$/m)?.[1]
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (!party) throw new Error('Onboarding did not produce APP_PROVIDER_PARTY');
    const userId = backendEnvironment.AUTH_APP_PROVIDER_BACKEND_USER_ID;
    const issuer = backendEnvironment.AUTH_APP_PROVIDER_ISSUER_URL;
    const clientId = backendEnvironment.AUTH_APP_PROVIDER_BACKEND_CLIENT_ID;
    const webClientId = backendEnvironment.AUTH_APP_PROVIDER_BACKEND_OIDC_CLIENT_ID;
    if (!webClientId) throw new Error('Missing AppProvider web client ID');
    const clientSecret = backendEnvironment.AUTH_APP_PROVIDER_BACKEND_SECRET;
    if (!userId || !issuer || !clientId || !clientSecret)
      throw new Error('Missing OAuth service credentials after onboarding');
    // Reuse Quickstart's demo wallet identity, whose rights authorize the App User party.
    const appUser = JSON.parse(
      await run(
        compose(
          'exec',
          '-T',
          'splice-onboarding',
          'bash',
          '-ec',
          `source /app/app-user-auth.sh >/dev/null; jq -n --arg party "$APP_USER_PARTY" --arg token "$APP_USER_WALLET_ADMIN_TOKEN" --arg userId "$AUTH_APP_USER_WALLET_ADMIN_USER_ID" '{party: $party, token: $token, userId: $userId}'`,
        ),
        { capture: true },
      ),
    ) as { party: string; token: string; userId: string };
    if (!appUser.party || !appUser.token || !appUser.userId)
      throw new Error('Missing App User identity after onboarding');
    const postgresEnvironment = Object.fromEntries(
      [
        'POSTGRES_HOST',
        'POSTGRES_PORT',
        'POSTGRES_DATABASE',
        'POSTGRES_USERNAME',
        'POSTGRES_PASSWORD',
      ].map((name) => {
        const value = backendEnvironment[name];
        if (!value) throw new Error(`Missing ${name} in rendered backend configuration`);
        return [name, value];
      }),
    );
    const tokenEnvironment = {
      ...postgresEnvironment,
      APP_USER_LEDGER_API_URL: 'http://canton:2975',
      APP_USER_WALLET_API_URL: 'http://splice:2903',
      TOKEN_REGISTRY_URL: backendEnvironment.REGISTRY_BASE_URI,
      APP_USER_PARTY: appUser.party,
      APP_USER_TOKEN: appUser.token,
      APP_USER_LEDGER_USER_ID: appUser.userId,
      AUTH_MODE: 'oauth2',
      LEDGER_API_URL: 'http://canton:3975',
      LEDGER_API_ALLOW_HTTP: 'true',
      LEDGER_API_USER_ID: userId,
      APP_PROVIDER_PARTY: party,
      AUTH_APP_PROVIDER_ISSUER_URL: issuer,
      AUTH_APP_PROVIDER_BACKEND_CLIENT_ID: clientId,
      AUTH_APP_PROVIDER_BACKEND_OIDC_CLIENT_ID: webClientId,
      AUTH_APP_PROVIDER_BACKEND_SECRET: clientSecret,
      LEDGER_OAUTH_ALLOW_HTTP: 'true',
    };
    const credentialsFile = join(directory, 'test.env');
    await writeFile(
      credentialsFile,
      `${Object.entries(tokenEnvironment)
        .map(([name, value]) => `${name}=${value}`)
        .join('\n')}\n`,
      { mode: 0o600 },
    );
    const bunVersion = (await readFile(join(repository, '.bun-version'), 'utf8')).trim();

    // Java migration comparisons require a host JDK and run through their own command.
    const testFiles = (await readdir(join(backend, 'integration')))
      .filter((name) => name.endsWith('.test.ts'))
      .sort()
      .map((name) => `./integration/${name}`);
    console.info('Running ledger tests against the provisioned participants...');
    await run([
      'docker',
      'run',
      '--rm',
      '--init',
      '--name',
      testContainer,
      '--network',
      `${project}-default`,
      '--env-file',
      credentialsFile,
      '--mount',
      `type=bind,source=${repository},target=/workspace,readonly`,
      '--workdir',
      '/workspace/quickstart/backend-ts',
      `oven/bun:${bunVersion}-slim`,
      'bun',
      '--no-env-file',
      'test',
      ...testFiles,
      ...process.argv.slice(2),
    ]);
    await checkImage?.(project, credentialsFile);
  } catch (error) {
    cleaningUp = true;
    exitCode = error instanceof CommandError ? error.code : EXIT_CODE_FAILURE;
    console.error(error instanceof Error ? error.message : 'Integration run failed');
    if (configured) {
      const logsDirectory = join(backend, 'integration-results', project);
      try {
        await mkdir(logsDirectory, { recursive: true, mode: 0o700 });
        const logs = await run(compose('logs', '--no-color'), { capture: true });
        await writeFile(join(logsDirectory, 'compose.log'), logs, { mode: 0o600 });
        console.error(`LocalNet diagnostics saved to ${logsDirectory}`);
      } catch {
        console.error('Unable to collect LocalNet logs');
      }
    }
  } finally {
    cleaningUp = true;
    console.info('Cleaning up integration resources...');
    let cleanupFailed = false;
    try {
      const exists = await run(['docker', 'ps', '-aq', '--filter', `name=^/${testContainer}$`], {
        capture: true,
      });
      if (exists.trim()) await run(['docker', 'rm', '-f', testContainer], { capture: true });
    } catch (error) {
      cleanupFailed = true;
      console.error(
        `Test container cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    try {
      if (configured)
        await run(
          compose(
            'down',
            '--volumes',
            '--remove-orphans',
            '--timeout',
            String(SHUTDOWN_TIMEOUT_SECONDS),
          ),
        );
    } catch (error) {
      cleanupFailed = true;
      console.error(
        `LocalNet cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    if (cleanupFailed) {
      exitCode ||= EXIT_CODE_FAILURE;
      console.error(`Cleanup configuration retained at ${composeFile}`);
    } else {
      await rm(directory, { recursive: true, force: true });
    }
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  process.exitCode = interrupted ? EXIT_CODE_INTERRUPTED : exitCode;
}

if (import.meta.main) await runIntegration();
