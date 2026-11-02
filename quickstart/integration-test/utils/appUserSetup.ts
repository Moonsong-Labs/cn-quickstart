import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import type TagProvider from '../fixtures/workflow';
import { requiredEnv } from './env';
import type { Keycloak } from './keycloak';
import { createUser as createLedgerUser, createParty, grantRights } from './ledger';

export default class AppUserSetup {
  request: APIRequestContext;
  tagProvider: TagProvider;
  userName!: string;
  userId!: string;
  partyId!: string;

  private constructor(request: APIRequestContext, tagProvider: TagProvider) {
    this.request = request;
    this.tagProvider = tagProvider;
  }

  static async create(
    request: APIRequestContext,
    keycloak: Keycloak,
    tagProvider: TagProvider,
  ): Promise<AppUserSetup> {
    const instance = new AppUserSetup(request, tagProvider);
    const tag = tagProvider.base;

    console.log(`Creating user with tag: ${tag}`);
    const secret = requiredEnv('AUTH_APP_USER_VALIDATOR_CLIENT_SECRET');
    const clientId = requiredEnv('AUTH_APP_USER_VALIDATOR_CLIENT_ID');
    const partyIdHint = `${tag}-${process.env.APP_USER_PARTY_HINT || 'app-user'}`;
    const participant = `localhost:2${process.env.PARTICIPANT_JSON_API_PORT_SUFFIX}`;

    // 0. Get admin token for the app user participant
    const adminToken = await keycloak.getAdminToken(secret, clientId);

    // 1. Create a new ledger party
    instance.partyId = await createParty(request, adminToken, partyIdHint, participant);

    // 2. Create a new keycloak user
    instance.userId = await keycloak.createUser(instance.partyId, tag);

    // 3. Create a new ledger user
    await createLedgerUser(
      request,
      adminToken,
      instance.userId,
      tag,
      instance.partyId,
      participant,
    );

    // 4. Grant rights to the user
    await grantRights(
      request,
      adminToken,
      instance.userId,
      instance.partyId,
      'ReadAs ActAs',
      participant,
    );

    instance.userName = `app-user-${tag}`;
    return instance;
  }

  public createAppInstallRequest(uniqueRequestTag: string) {
    const env = {
      ...process.env,
      TEST_UNIQUE_REQUEST_TAG: uniqueRequestTag,
      TEST_MODE: 'on',
      TEST_AUTH_APP_USER_WALLET_ADMIN_USER_NAME: this.userName,
      TEST_AUTH_APP_USER_WALLET_ADMIN_USER_ID: this.userId,
      TEST_APP_USER_PARTY: this.partyId,
    };

    console.log('Run create-app-install-request shell script.');

    const timeoutMs = Number(process.env.CREATE_APP_INSTALL_REQUEST_TIMEOUT_MS) || 1 * 30 * 1000; // default 30 seconds
    execFileSync('bun', ['--no-env-file', 'cli/src/main.ts', 'demo', 'install-request'], {
      cwd: resolve(__dirname, '../..'),
      env,
      stdio: 'inherit',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });

    console.log(`AppInstallRequest created with tag: ${uniqueRequestTag}`);
  }
}
