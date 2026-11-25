// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect, useState } from 'react';
import { Badge } from '../components/Badge';
import { Button, type ButtonVariant } from '../components/Button';
import { DescriptionItem, DescriptionList } from '../components/DescriptionList';
import { Page, PageBody } from '../components/Page';
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
      <PageBody>
        <p className="text-muted-foreground">Log in to see installations.</p>
      </PageBody>
    );
  }

  const viewer: Role = user.isAdmin ? 'provider' : 'user';
  const title = viewer === 'provider' ? 'Installations' : 'Applications';
  const selected = selectedItem(unifiedInstalls, picked);

  const run = (action: InstallAction, item: AppInstallUnified) => {
    // Picking the item lets the selection follow it to its installation after Accept.
    setPicked(item);
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
    <Page
      title={title}
      subtitle="Licensing Demo"
    >
      {selected === undefined ? (
        <PageBody>
          <p className="mb-1 font-medium">No installation requests yet.</p>
          <RequestHint />
        </PageBody>
      ) : (
        <div className="flex flex-1 flex-col lg:flex-row">
          <div className="flex shrink-0 flex-col border-b border-border p-5 lg:w-96 lg:border-r lg:border-b-0">
            <ul
              aria-label={title}
              className="flex flex-col gap-2"
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
            className="min-w-0 flex-1"
          >
            <PageBody>
              <InstallDetail
                item={selected}
                stage={installStage(selected, unifiedInstalls, viewer)}
                viewer={viewer}
                onAction={(action) => run(action, selected)}
              />
            </PageBody>
          </section>
        </div>
      )}
    </Page>
  );
};

const RequestHint: React.FC = () => (
  <p className="text-sm text-subtle-foreground">
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
  const metaEntries = Object.entries(item.meta?.data ?? {});
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
        className={`focus-ring flex w-full cursor-pointer items-start justify-between gap-3 rounded-lg border-l-4 px-4 py-3 text-left transition-colors ${
          isSelected
            ? 'border-primary bg-primary-subtle'
            : 'border-transparent bg-background hover:bg-muted-subtle'
        }`}
      >
        <span className="min-w-0">
          <span className="block truncate font-semibold">
            {partyHint(viewer === 'provider' ? item.user : item.provider)}
          </span>
          <span className="block text-sm text-muted-foreground">{line}</span>
          {metaEntries.map(([key, value]) => (
            <span
              key={key}
              className="block truncate font-mono text-xs text-subtle-foreground"
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
        <h2 className="text-3xl font-bold tracking-tight">
          {stage.status === 'requested' ? 'Installation request' : 'Installation'}
        </h2>
        <StatusBadge status={stage.status} />
      </div>

      <div className="mt-6">
        <DescriptionList>
          <DescriptionItem term={viewer === 'provider' ? 'User' : 'Provider'}>
            {partyHint(viewer === 'provider' ? item.user : item.provider)}
          </DescriptionItem>
          {stage.status === 'installed' && (
            <DescriptionItem
              term="Licenses"
              data-testid="num-licenses"
            >
              {item.numLicensesCreated}
            </DescriptionItem>
          )}
          {metaEntries.map(([key, value]) => (
            <DescriptionItem
              key={key}
              term={key}
              code
            >
              {value}
            </DescriptionItem>
          ))}
        </DescriptionList>
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <h3 className="mb-3 text-xl font-bold">Next step</h3>
        <p>
          {stage.turn !== null && (
            <span className="mr-2">
              <Badge
                shape="pill"
                tone={stage.turn === viewer ? 'primary' : 'neutral'}
              >
                {stage.turn === viewer ? 'Your turn' : `Waiting for ${ROLE_NAME[stage.turn]}`}
              </Badge>
            </span>
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
            <p className="mt-3 text-sm text-subtle-foreground">
              Your validator node signs these actions for your party.
            </p>
          </>
        )}
      </div>

      <details className="mt-8 border-t border-border pt-5">
        <summary className="focus-ring cursor-pointer font-semibold">Technical details</summary>
        <div className="mt-3">
          <DescriptionList size="sm">
            <DescriptionItem
              term="Contract ID"
              code
            >
              {item.contractId}
            </DescriptionItem>
            <DescriptionItem
              term="Provider"
              code
            >
              {item.provider}
            </DescriptionItem>
            <DescriptionItem
              term="User"
              code
            >
              {item.user}
            </DescriptionItem>
          </DescriptionList>
        </div>
      </details>
    </div>
  );
};

const StatusBadge: React.FC<{ status: InstallStage['status'] }> = ({ status }) =>
  status === 'requested' ? (
    <Badge tone="warning">Requested</Badge>
  ) : (
    <Badge tone="success">Installed</Badge>
  );

export default AppInstallsView;
