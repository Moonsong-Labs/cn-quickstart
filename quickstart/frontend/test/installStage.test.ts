// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { expect, test } from 'bun:test';
import { installStage } from '../src/lifecycle/installStage';
import type { AppInstallUnified } from '../src/types';

const provider = 'app_provider::1220aa';

function request(user: string): AppInstallUnified {
  return {
    status: 'REQUEST',
    contractId: `request-${user}`,
    provider,
    user,
    meta: { data: {} },
    numLicensesCreated: 0,
  };
}

function install(user: string): AppInstallUnified {
  return { ...request(user), status: 'INSTALL', contractId: `install-${user}` };
}

test('the provider can accept a request from a user without an installation', () => {
  const item = request('alice::1220bb');
  const stage = installStage(item, [item, install('bob::1220cc')], 'provider');
  expect(stage).toMatchObject({ turn: 'provider', note: 'acceptOrReject' });
  expect(stage.actions).toEqual(['accept', 'reject']);
});

test('the provider can only reject a request from a user who already has an installation', () => {
  const item = request('alice::1220bb');
  const stage = installStage(item, [item, install('alice::1220bb')], 'provider');
  expect(stage).toMatchObject({ turn: 'provider', note: 'alreadyInstalled' });
  expect(stage.actions).toEqual(['reject']);
});

test('the user waits for the provider and cannot act on their own request', () => {
  const item = request('alice::1220bb');
  const stage = installStage(item, [item], 'user');
  expect(stage).toMatchObject({ turn: 'provider', note: 'awaitingProvider' });
  expect(stage.actions).toEqual([]);
});

test('only the provider creates licenses on an installation, and both roles can cancel it', () => {
  const item = install('alice::1220bb');
  expect(installStage(item, [item], 'provider').actions).toEqual(['createLicense', 'cancel']);
  expect(installStage(item, [item], 'user').actions).toEqual(['cancel']);
});
