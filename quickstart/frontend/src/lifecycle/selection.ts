// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { AppInstallUnified } from '../types';

/**
 * The item to show in the detail panel: the one the viewer picked while it exists. Accepting a
 * request archives it and creates an installation with a new contract ID, so the selection then
 * follows the same user to that installation. Without a match, the first item.
 */
export function selectedItem(
  items: readonly AppInstallUnified[],
  picked: AppInstallUnified | null,
): AppInstallUnified | undefined {
  return (
    items.find((item) => item.contractId === picked?.contractId) ??
    items.find((item) => item.user === picked?.user && item.status === 'INSTALL') ??
    items[0]
  );
}
