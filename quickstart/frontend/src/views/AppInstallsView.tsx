// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect, useState } from 'react';
import { Button, type ButtonVariant } from '../components/Button';
import PageHeader from '../components/PageHeader';
import {
  type InstallAction,
  type InstallNote,
  type InstallStage,
  installStage,
  type Role,
} from '../lifecycle/installStage';
import { selectedItem } from '../lifecycle/selection';
import { useAppInstallStore } from '../stores/appInstallStore';
import { useUserStore } from '../stores/userStore';
import type { AppInstallUnified } from '../types';
import { partyHint } from '../utils/format';

const ROLE_NAME: Record<Role, string> = {
  provider: 'the App Provider',
  user: 'the App User',
};

const NOTE_TEXT: Record<InstallNote, string> = {
  acceptOrReject: 'Accept to create an installation for this user, or reject the request.',
  alreadyInstalled:
    'This user already has an installation. Cancel it before you accept a new request, or reject this one.',
  awaitingProvider: 'The App Provider accepts or rejects your request.',
  createLicenses: 'Create licenses for this user on this installation.',
  providerIssuesLicenses: 'The App Provider creates your licenses on this installation.',
};

const REQUEST_LINE: Partial<Record<InstallNote, string>> = {
  acceptOrReject: 'Waiting for you',
  alreadyInstalled: 'Already has an installation',
  awaitingProvider: 'Waiting for the App Provider',
};

const ACTION_LABEL: Record<InstallAction, string> = {
  accept: 'Accept',
  reject: 'Reject',
  createLicense: 'Create license',
  cancel: 'Cancel installation',
};

const ACTION_VARIANT: Record<InstallAction, ButtonVariant> = {
  accept: 'primary',
  createLicense: 'primary',
  reject: 'secondary',
  cancel: 'danger',
};

const AppInstallsView: React.FC = () => {
  const { unifiedInstalls, fetchAll, accept, reject, createLicense, cancelInstall } =
    useAppInstallStore();
  const { user, loading, fetchUser } = useUserStore();
  const [picked, setPicked] = useState<AppInstallUnified | null>(null);

  useEffect(() => {
    fetchUser();
    fetchAll();
    const intervalId = setInterval(() => {
      fetchAll();
    }, 5000);
    return () => clearInterval(intervalId);
  }, [fetchUser, fetchAll]);

  if (!user) {
    return loading ? null : (
      <p className="px-10 py-8 text-neutral-600">Log in to see installations.</p>
    );
  }

  const viewer: Role = user.isAdmin ? 'provider' : 'user';
  const title = viewer === 'provider' ? 'Installations' : 'Applications';
  const selected = selectedItem(unifiedInstalls, picked);

  const run = (action: InstallAction, item: AppInstallUnified) => {
    switch (action) {
      case 'accept':
        return accept(item.contractId, item.meta, {});
      case 'reject':
        return reject(item.contractId, {});
      case 'createLicense':
        return createLicense(item.contractId, {});
      case 'cancel':
        return cancelInstall(item.contractId, {});
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <PageHeader
        title={title}
        subtitle="Licensing Demo"
      />
      {selected === undefined ? (
        <div className="px-10 py-8">
          <p className="mb-1 font-medium">No installation requests yet.</p>
          <RequestHint />
        </div>
      ) : (
        <div className="flex flex-1">
          <div className="flex w-96 shrink-0 flex-col border-r border-neutral-200 p-5">
            <ul
              aria-label={title}
              className="m-0 flex list-none flex-col gap-2 p-0"
            >
              {unifiedInstalls.map((item) => (
                <InstallListItem
                  key={item.contractId}
                  item={item}
                  stage={installStage(item, unifiedInstalls, viewer)}
                  viewer={viewer}
                  isSelected={item.contractId === selected.contractId}
                  onSelect={() => setPicked(item)}
                />
              ))}
            </ul>
            <div className="mt-6 px-1">
              <RequestHint />
            </div>
          </div>
          <section
            aria-label="Installation details"
            className="min-w-0 flex-1 px-10 py-8"
          >
            <InstallDetail
              item={selected}
              stage={installStage(selected, unifiedInstalls, viewer)}
              viewer={viewer}
              onAction={(action) => run(action, selected)}
            />
          </section>
        </div>
      )}
    </div>
  );
};

const RequestHint: React.FC = () => (
  <p className="mb-0 text-sm text-neutral-500">
    Run <code>make create-app-install-request</code> to send a new request.
  </p>
);

interface InstallListItemProps {
  item: AppInstallUnified;
  stage: InstallStage;
  viewer: Role;
  isSelected: boolean;
  onSelect: () => void;
}

const InstallListItem: React.FC<InstallListItemProps> = ({
  item,
  stage,
  viewer,
  isSelected,
  onSelect,
}) => {
  const metaValues = Object.values(item.meta?.data ?? {});
  const line =
    stage.status === 'installed'
      ? `${item.numLicensesCreated} ${item.numLicensesCreated === 1 ? 'license' : 'licenses'}`
      : REQUEST_LINE[stage.note];

  return (
    <li>
      <button
        type="button"
        aria-current={isSelected ? 'true' : undefined}
        onClick={onSelect}
        className={`flex w-full items-start justify-between gap-3 rounded-lg border-0 border-l-4 px-4 py-3 text-left transition-colors ${
          isSelected
            ? 'border-brand-700 bg-brand-50'
            : 'border-transparent bg-white hover:bg-neutral-50'
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold">
            {partyHint(viewer === 'provider' ? item.user : item.provider)}
          </span>
          <span className="block text-sm text-neutral-600">{line}</span>
          {metaValues.map((value) => (
            <span
              key={value}
              className="block truncate font-mono text-xs text-neutral-500"
            >
              {value}
            </span>
          ))}
        </span>
        <StatusBadge status={stage.status} />
      </button>
    </li>
  );
};

interface InstallDetailProps {
  item: AppInstallUnified;
  stage: InstallStage;
  viewer: Role;
  onAction: (action: InstallAction) => void;
}

const InstallDetail: React.FC<InstallDetailProps> = ({ item, stage, viewer, onAction }) => {
  const metaEntries = Object.entries(item.meta?.data ?? {});

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3">
        <h2 className="mb-0 text-3xl font-bold tracking-tight">
          {stage.status === 'requested' ? 'Installation request' : 'Installation'}
        </h2>
        <StatusBadge status={stage.status} />
      </div>

      <dl className="mt-6 mb-0 grid grid-cols-[10rem_1fr] gap-y-3">
        <dt className="font-normal text-neutral-600">
          {viewer === 'provider' ? 'User' : 'Provider'}
        </dt>
        <dd className="mb-0">{partyHint(viewer === 'provider' ? item.user : item.provider)}</dd>
        {stage.status === 'installed' && (
          <>
            <dt className="font-normal text-neutral-600">Licenses</dt>
            <dd
              className="mb-0"
              data-testid="num-licenses"
            >
              {item.numLicensesCreated}
            </dd>
          </>
        )}
        {metaEntries.map(([key, value]) => (
          <div
            key={key}
            className="contents"
          >
            <dt className="font-normal text-neutral-600">{key}</dt>
            <dd className="mb-0 font-mono text-sm leading-6">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 border-t border-neutral-200 pt-6">
        <h3 className="mb-3 text-xl font-bold">Next step</h3>
        <p className="mb-0">
          {stage.turn !== null && (
            <TurnBadge
              turn={stage.turn}
              viewer={viewer}
            />
          )}
          {NOTE_TEXT[stage.note]}
        </p>
        {stage.actions.length > 0 && (
          <>
            <div className="mt-5 flex flex-wrap gap-3">
              {stage.actions.map((action) => (
                <Button
                  key={action}
                  variant={ACTION_VARIANT[action]}
                  size="lg"
                  onClick={() => onAction(action)}
                >
                  {ACTION_LABEL[action]}
                </Button>
              ))}
            </div>
            <p className="mt-3 mb-0 text-sm text-neutral-500">
              Your validator node signs these actions for your party.
            </p>
          </>
        )}
      </div>

      <details className="mt-8 border-t border-neutral-200 pt-5">
        <summary className="cursor-pointer font-semibold">Technical details</summary>
        <dl className="mt-3 mb-0 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="font-normal text-neutral-600">Contract ID</dt>
          <dd className="mb-0 font-mono text-xs leading-5 break-all">{item.contractId}</dd>
          <dt className="font-normal text-neutral-600">Provider</dt>
          <dd className="mb-0 font-mono text-xs leading-5 break-all">{item.provider}</dd>
          <dt className="font-normal text-neutral-600">User</dt>
          <dd className="mb-0 font-mono text-xs leading-5 break-all">{item.user}</dd>
        </dl>
      </details>
    </div>
  );
};

const StatusBadge: React.FC<{ status: InstallStage['status'] }> = ({ status }) =>
  status === 'requested' ? (
    <span className="shrink-0 rounded-md bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-800">
      Requested
    </span>
  ) : (
    <span className="shrink-0 rounded-md bg-brand-50 px-2.5 py-1 text-sm font-medium text-brand-800">
      Installed
    </span>
  );

const TurnBadge: React.FC<{ turn: Role; viewer: Role }> = ({ turn, viewer }) => (
  <span
    className={`mr-2 inline-block rounded-full px-2.5 py-0.5 text-sm font-semibold ${
      turn === viewer ? 'bg-brand-700 text-white' : 'bg-neutral-100 text-neutral-700'
    }`}
  >
    {turn === viewer ? 'Your turn' : `Waiting for ${ROLE_NAME[turn]}`}
  </span>
);

export default AppInstallsView;
