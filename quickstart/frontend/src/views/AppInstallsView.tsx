// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect } from 'react';
import {
  type InstallAction,
  type InstallNote,
  type InstallStage,
  installStage,
  type Role,
} from '../lifecycle/installStage';
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

const ACTION_LABEL: Record<InstallAction, string> = {
  accept: 'Accept',
  reject: 'Reject',
  createLicense: 'Create license',
  cancel: 'Cancel installation',
};

const BUTTON_BASE =
  'tw:rounded-lg tw:px-4 tw:py-2 tw:text-sm tw:font-medium tw:transition-colors tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-brand-600';

const ACTION_STYLE: Record<InstallAction, string> = {
  accept: 'tw:border tw:border-brand-700 tw:bg-brand-700 tw:text-white tw:hover:bg-brand-800',
  createLicense:
    'tw:border tw:border-brand-700 tw:bg-brand-700 tw:text-white tw:hover:bg-brand-800',
  reject: 'tw:border tw:border-neutral-300 tw:bg-white tw:text-neutral-800 tw:hover:bg-neutral-100',
  cancel: 'tw:border tw:border-red-300 tw:bg-white tw:text-red-700 tw:hover:bg-red-50',
};

const AppInstallsView: React.FC = () => {
  const { unifiedInstalls, fetchAll, accept, reject, createLicense, cancelInstall } =
    useAppInstallStore();
  const { user, loading, fetchUser } = useUserStore();

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
      <p className="tw:font-sans tw:text-sm tw:text-neutral-600">Log in to see installations.</p>
    );
  }

  const viewer: Role = user.isAdmin ? 'provider' : 'user';
  const title = viewer === 'provider' ? 'Installations' : 'Applications';

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
    <section className="tw:mx-auto tw:max-w-4xl tw:font-sans tw:text-neutral-900">
      <header className="tw:mb-6">
        <h2 className="tw:mb-1 tw:text-2xl tw:font-semibold">{title}</h2>
        <p className="tw:mb-0 tw:text-sm tw:text-neutral-600">
          {viewer === 'provider'
            ? 'App Users ask to install the app. Accept a request to create an installation, then create licenses on it.'
            : 'Your requests to install the app, and the installations the App Provider accepted.'}{' '}
          Run <code>make create-app-install-request</code> to send a new request.
        </p>
      </header>
      {unifiedInstalls.length === 0 ? (
        <p className="tw:rounded-xl tw:border tw:border-dashed tw:border-neutral-300 tw:p-6 tw:text-center tw:text-sm tw:text-neutral-600">
          No installation requests yet.
        </p>
      ) : (
        <ul
          aria-label={title}
          className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-3 tw:p-0"
        >
          {unifiedInstalls.map((item) => (
            <InstallItem
              key={item.contractId}
              item={item}
              stage={installStage(item, unifiedInstalls, viewer)}
              viewer={viewer}
              onAction={(action) => run(action, item)}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

interface InstallItemProps {
  item: AppInstallUnified;
  stage: InstallStage;
  viewer: Role;
  onAction: (action: InstallAction) => void;
}

const InstallItem: React.FC<InstallItemProps> = ({ item, stage, viewer, onAction }) => {
  const counterpart =
    viewer === 'provider'
      ? `User · ${partyHint(item.user)}`
      : `Provider · ${partyHint(item.provider)}`;
  const metaEntries = Object.entries(item.meta?.data ?? {});

  return (
    <li className="tw:rounded-xl tw:border tw:border-neutral-200 tw:bg-white tw:p-5 tw:shadow-xs">
      <div className="tw:flex tw:items-start tw:justify-between tw:gap-4">
        <div>
          <h3 className="tw:mb-0.5 tw:text-base tw:font-semibold">
            {stage.status === 'requested' ? 'Installation request' : 'Installation'}
          </h3>
          <p className="tw:mb-0 tw:text-sm tw:text-neutral-600">{counterpart}</p>
        </div>
        <StatusBadge status={stage.status} />
      </div>

      <p className="tw:mt-3 tw:mb-0 tw:text-sm">
        {stage.turn !== null && (
          <TurnBadge
            turn={stage.turn}
            viewer={viewer}
          />
        )}
        {NOTE_TEXT[stage.note]}
      </p>

      {(metaEntries.length > 0 || stage.status === 'installed') && (
        <dl className="tw:mt-3 tw:mb-0 tw:flex tw:flex-wrap tw:gap-x-6 tw:gap-y-1 tw:text-sm">
          {stage.status === 'installed' && (
            <div className="tw:flex tw:gap-2">
              <dt className="tw:font-normal tw:text-neutral-600">Licenses</dt>
              <dd
                className="tw:mb-0 tw:font-medium"
                data-testid="num-licenses"
              >
                {item.numLicensesCreated}
              </dd>
            </div>
          )}
          {metaEntries.map(([key, value]) => (
            <div
              key={key}
              className="tw:flex tw:gap-2"
            >
              <dt className="tw:font-normal tw:text-neutral-600">{key}</dt>
              <dd className="tw:mb-0 tw:font-mono tw:text-xs tw:leading-5">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {stage.actions.length > 0 && (
        <div className="tw:mt-4">
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            {stage.actions.map((action) => (
              <button
                key={action}
                type="button"
                className={`${BUTTON_BASE} ${ACTION_STYLE[action]}`}
                onClick={() => onAction(action)}
              >
                {ACTION_LABEL[action]}
              </button>
            ))}
          </div>
          <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-neutral-500">
            Your validator node signs these actions for your party.
          </p>
        </div>
      )}

      <details className="tw:mt-4 tw:border-t tw:border-neutral-200 tw:pt-3 tw:text-sm">
        <summary className="tw:cursor-pointer tw:font-medium tw:text-neutral-700">
          Technical details
        </summary>
        <dl className="tw:mt-2 tw:mb-0 tw:grid tw:grid-cols-[max-content_1fr] tw:gap-x-4 tw:gap-y-1">
          <dt className="tw:font-normal tw:text-neutral-600">Contract ID</dt>
          <dd className="tw:mb-0 tw:font-mono tw:text-xs tw:leading-5 tw:break-all">
            {item.contractId}
          </dd>
          <dt className="tw:font-normal tw:text-neutral-600">Provider</dt>
          <dd className="tw:mb-0 tw:font-mono tw:text-xs tw:leading-5 tw:break-all">
            {item.provider}
          </dd>
          <dt className="tw:font-normal tw:text-neutral-600">User</dt>
          <dd className="tw:mb-0 tw:font-mono tw:text-xs tw:leading-5 tw:break-all">{item.user}</dd>
        </dl>
      </details>
    </li>
  );
};

const StatusBadge: React.FC<{ status: InstallStage['status'] }> = ({ status }) =>
  status === 'requested' ? (
    <span className="tw:shrink-0 tw:rounded-md tw:bg-amber-100 tw:px-2 tw:py-0.5 tw:text-sm tw:font-medium tw:text-amber-800">
      Waiting for acceptance
    </span>
  ) : (
    <span className="tw:shrink-0 tw:rounded-md tw:bg-brand-50 tw:px-2 tw:py-0.5 tw:text-sm tw:font-medium tw:text-brand-800">
      Installed
    </span>
  );

const TurnBadge: React.FC<{ turn: Role; viewer: Role }> = ({ turn, viewer }) => (
  <span
    className={`tw:mr-2 tw:inline-block tw:rounded-full tw:px-2 tw:py-0.5 tw:text-xs tw:font-semibold ${
      turn === viewer ? 'tw:bg-brand-700 tw:text-white' : 'tw:bg-neutral-100 tw:text-neutral-700'
    }`}
  >
    {turn === viewer ? 'Your turn' : `Waiting for ${ROLE_NAME[turn]}`}
  </span>
);

export default AppInstallsView;
