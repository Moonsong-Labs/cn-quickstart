// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { AppInstallUnified } from '../types';

/** A party's role in the licensing flow. The App Provider's users are admins. */
export type Role = 'provider' | 'user';

/** An action a viewer can take on an installation item. */
export type InstallAction = 'accept' | 'reject' | 'cancel' | 'createLicense';

/**
 * Why the item reads as it does. The view turns it into the sentence next to the item.
 * `alreadyInstalled` means the provider cannot accept, because the user already has an installation.
 */
export type InstallNote =
  | 'acceptOrReject'
  | 'alreadyInstalled'
  | 'awaitingProvider'
  | 'createLicenses'
  | 'providerIssuesLicenses';

/** Where an installation item stands, who acts next, and what the viewer can do. */
export interface InstallStage {
  status: 'requested' | 'installed';
  /** The role that acts next, or `null` when nothing waits on anyone. */
  turn: Role | null;
  note: InstallNote;
  actions: InstallAction[];
}

/**
 * Derives the stage of one installation item for a viewer.
 *
 * `items` is every request and installation the viewer can see. The provider cannot accept a
 * request from a user who already has an installation with that provider, because
 * `License.licenseNum` is unique only while each user has one `AppInstall` per provider.
 */
export function installStage(
  item: AppInstallUnified,
  items: readonly AppInstallUnified[],
  viewer: Role,
): InstallStage {
  if (item.status === 'INSTALL') {
    return viewer === 'provider'
      ? {
          status: 'installed',
          turn: null,
          note: 'createLicenses',
          actions: ['createLicense', 'cancel'],
        }
      : { status: 'installed', turn: null, note: 'providerIssuesLicenses', actions: ['cancel'] };
  }
  if (viewer === 'user') {
    return { status: 'requested', turn: 'provider', note: 'awaitingProvider', actions: [] };
  }
  const installed = items.some(
    (other) =>
      other.status === 'INSTALL' && other.user === item.user && other.provider === item.provider,
  );
  return installed
    ? { status: 'requested', turn: 'provider', note: 'alreadyInstalled', actions: ['reject'] }
    : {
        status: 'requested',
        turn: 'provider',
        note: 'acceptOrReject',
        actions: ['accept', 'reject'],
      };
}
