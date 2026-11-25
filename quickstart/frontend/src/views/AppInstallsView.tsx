// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect, useState } from 'react';
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

const BUTTON_BASE =
  'tw:rounded-lg tw:px-6 tw:py-2.5 tw:text-base tw:font-semibold tw:transition-colors tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-brand-600';

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
      <p className="tw:px-10 tw:py-8 tw:text-neutral-600">Log in to see installations.</p>
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
    <div className="tw:flex tw:min-h-screen tw:flex-col">
      <PageHeader
        title={title}
        subtitle="Licensing Demo"
      />
      {selected === undefined ? (
        <div className="tw:px-10 tw:py-8">
          <p className="tw:mb-1 tw:font-medium">No installation requests yet.</p>
          <RequestHint />
        </div>
      ) : (
        <div className="tw:flex tw:flex-1">
          <div className="tw:flex tw:w-96 tw:shrink-0 tw:flex-col tw:border-r tw:border-neutral-200 tw:p-5">
            <ul
              aria-label={title}
              className="tw:m-0 tw:flex tw:list-none tw:flex-col tw:gap-2 tw:p-0"
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
            <div className="tw:mt-6 tw:px-1">
              <RequestHint />
            </div>
          </div>
          <section
            aria-label="Installation details"
            className="tw:min-w-0 tw:flex-1 tw:px-10 tw:py-8"
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
  <p className="tw:mb-0 tw:text-sm tw:text-neutral-500">
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
        className={`tw:flex tw:w-full tw:items-start tw:justify-between tw:gap-3 tw:rounded-lg tw:border-0 tw:border-l-4 tw:px-4 tw:py-3 tw:text-left tw:transition-colors ${
          isSelected
            ? 'tw:border-brand-700 tw:bg-brand-50'
            : 'tw:border-transparent tw:bg-white tw:hover:bg-neutral-50'
        }`}
      >
        <span className="tw:min-w-0">
          <span className="tw:block tw:truncate tw:font-semibold">
            {partyHint(viewer === 'provider' ? item.user : item.provider)}
          </span>
          <span className="tw:block tw:text-sm tw:text-neutral-600">{line}</span>
          {metaValues.map((value) => (
            <span
              key={value}
              className="tw:block tw:truncate tw:font-mono tw:text-xs tw:text-neutral-500"
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
    <div className="tw:max-w-3xl">
      <div className="tw:flex tw:items-center tw:gap-3">
        <h2 className="tw:mb-0 tw:text-3xl tw:font-bold tw:tracking-tight">
          {stage.status === 'requested' ? 'Installation request' : 'Installation'}
        </h2>
        <StatusBadge status={stage.status} />
      </div>

      <dl className="tw:mt-6 tw:mb-0 tw:grid tw:grid-cols-[10rem_1fr] tw:gap-y-3">
        <dt className="tw:font-normal tw:text-neutral-600">
          {viewer === 'provider' ? 'User' : 'Provider'}
        </dt>
        <dd className="tw:mb-0">{partyHint(viewer === 'provider' ? item.user : item.provider)}</dd>
        {stage.status === 'installed' && (
          <>
            <dt className="tw:font-normal tw:text-neutral-600">Licenses</dt>
            <dd
              className="tw:mb-0"
              data-testid="num-licenses"
            >
              {item.numLicensesCreated}
            </dd>
          </>
        )}
        {metaEntries.map(([key, value]) => (
          <div
            key={key}
            className="tw:contents"
          >
            <dt className="tw:font-normal tw:text-neutral-600">{key}</dt>
            <dd className="tw:mb-0 tw:font-mono tw:text-sm tw:leading-6">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="tw:mt-6 tw:border-t tw:border-neutral-200 tw:pt-6">
        <h3 className="tw:mb-3 tw:text-xl tw:font-bold">Next step</h3>
        <p className="tw:mb-0">
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
            <div className="tw:mt-5 tw:flex tw:flex-wrap tw:gap-3">
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
            <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:text-neutral-500">
              Your validator node signs these actions for your party.
            </p>
          </>
        )}
      </div>

      <details className="tw:mt-8 tw:border-t tw:border-neutral-200 tw:pt-5">
        <summary className="tw:cursor-pointer tw:font-semibold">Technical details</summary>
        <dl className="tw:mt-3 tw:mb-0 tw:grid tw:grid-cols-[10rem_1fr] tw:gap-x-4 tw:gap-y-2 tw:text-sm">
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
    </div>
  );
};

const StatusBadge: React.FC<{ status: InstallStage['status'] }> = ({ status }) =>
  status === 'requested' ? (
    <span className="tw:shrink-0 tw:rounded-md tw:bg-amber-100 tw:px-2.5 tw:py-1 tw:text-sm tw:font-medium tw:text-amber-800">
      Requested
    </span>
  ) : (
    <span className="tw:shrink-0 tw:rounded-md tw:bg-brand-50 tw:px-2.5 tw:py-1 tw:text-sm tw:font-medium tw:text-brand-800">
      Installed
    </span>
  );

const TurnBadge: React.FC<{ turn: Role; viewer: Role }> = ({ turn, viewer }) => (
  <span
    className={`tw:mr-2 tw:inline-block tw:rounded-full tw:px-2.5 tw:py-0.5 tw:text-sm tw:font-semibold ${
      turn === viewer ? 'tw:bg-brand-700 tw:text-white' : 'tw:bg-neutral-100 tw:text-neutral-700'
    }`}
  >
    {turn === viewer ? 'Your turn' : `Waiting for ${ROLE_NAME[turn]}`}
  </span>
);

export default AppInstallsView;
