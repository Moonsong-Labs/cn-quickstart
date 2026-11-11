import { expect, test } from 'bun:test';
import type { LedgerCommonSchemas } from '@canton-network/core-ledger-client-types';
import {
  AppInstall,
  AppInstallRequest,
  License,
  LicenseRenewalRequest,
} from '../src/daml/licensing';

const installation = {
  provider: 'provider::test',
  user: 'user::test',
  meta: { values: { description: 'Test installation' } },
  numLicensesCreated: '9007199254740993',
} satisfies AppInstall;

test('Encodes a typed contract for the SDK JSON request without losing integer precision', () => {
  const command: LedgerCommonSchemas['CreateCommand'] = {
    templateId: AppInstall.templateId,
    createArguments: AppInstall.encode(installation),
  };
  const json = JSON.parse(JSON.stringify(command));
  const decoded = AppInstall.decoder.runWithException(json.createArguments);

  expect(decoded).toEqual(installation);
  expect(decoded.numLicensesCreated).toBe('9007199254740993');
});

test('Preserves decimal amounts, timestamps and relative time in choice arguments', () => {
  const argument = {
    requestId: 'renewal-1',
    licenseFeeInstrumentId: { admin: 'issuer::test', id: 'test-token' },
    licenseFeeAmount: '123456789012345678.1234567890',
    licenseExtensionDuration: { microseconds: '86400000000' },
    requestedAt: '2026-10-22T12:00:00.123456Z',
    prepareUntil: '2026-10-22T13:00:00.123456Z',
    settleBefore: '2026-10-22T14:00:00.123456Z',
    description: 'Renew test license',
  } satisfies Parameters<typeof License.License_Renew.argumentEncode>[0];
  const choice = License.License_Renew;
  const encoded = JSON.parse(JSON.stringify(choice.argumentEncode(argument)));

  expect(choice.argumentDecoder.runWithException(encoded)).toEqual(argument);
});

test('Resolves Token Standard dependencies and preserves nested choice-context variants', () => {
  const argument = {
    allocationCid: 'allocation-contract-id',
    licenseCid: 'license-contract-id',
    extraArgs: {
      context: {
        values: {
          count: { tag: 'AV_Int', value: '9007199254740993' },
          fee: { tag: 'AV_Decimal', value: '0.1234567890' },
          references: {
            tag: 'AV_List',
            value: [{ tag: 'AV_Text', value: 'transfer-context' }],
          },
        },
      },
      meta: { values: {} },
    },
  };
  const choice = LicenseRenewalRequest.LicenseRenewalRequest_CompleteRenewal;
  const decoded = choice.argumentDecoder.runWithException(argument);

  expect(JSON.parse(JSON.stringify(choice.argumentEncode(decoded)))).toEqual(argument);
});

test('Decodes choice results with typed contract references', () => {
  const accepted = AppInstallRequest.AppInstallRequest_Accept.resultDecoder.runWithException(
    'installation-contract-id',
  );
  const created = AppInstall.AppInstall_CreateLicense.resultDecoder.runWithException({
    installId: 'installation-contract-id',
    licenseId: 'license-contract-id',
  });

  expect(accepted.toString()).toBe('installation-contract-id');
  expect(created.installId).toBe(accepted);
  expect(created.licenseId.toString()).toBe('license-contract-id');
  expect(() =>
    AppInstall.AppInstall_CreateLicense.resultDecoder.runWithException({
      installId: accepted,
      licenseId: false,
    }),
  ).toThrow();
});

test.each([
  { ...installation, provider: undefined },
  { ...installation, numLicensesCreated: true },
])('Rejects malformed contract payloads at runtime', (payload) => {
  expect(() => AppInstall.decoder.runWithException(payload)).toThrow();
});
