// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { expect, test } from 'bun:test';
import { selectedItem } from '../src/lifecycle/selection';
import type { AppInstallUnified } from '../src/types';

function item(status: AppInstallUnified['status'], user: string): AppInstallUnified {
  return {
    status,
    contractId: `${status}-${user}`,
    provider: 'app_provider::1220aa',
    user,
    meta: { data: {} },
    numLicensesCreated: 0,
  };
}

test('the picked item stays selected while it exists, even when it is not first', () => {
  const picked = item('REQUEST', 'alice::1220bb');
  expect(selectedItem([item('INSTALL', 'bob::1220cc'), picked], picked)).toBe(picked);
});

test('after the picked request is accepted, the selection follows the user to the installation', () => {
  const picked = item('REQUEST', 'alice::1220bb');
  const installation = item('INSTALL', 'alice::1220bb');
  expect(selectedItem([item('INSTALL', 'bob::1220cc'), installation], picked)).toBe(installation);
});
