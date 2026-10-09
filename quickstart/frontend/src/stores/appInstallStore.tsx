// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import api from '../api';
import type {
  AppInstall as ApiAppInstall,
  AppInstallRequest as ApiAppInstallRequest,
  AppInstallCancel,
  AppInstallCreateLicenseRequest,
  AppInstallCreateLicenseResult,
  AppInstallRequestAccept,
  AppInstallRequestReject,
  Client,
  Metadata,
} from '../openapi.d.ts';
import type { AppInstallUnified } from '../types';
import { generateCommandId } from '../utils/commandId';
import { useWithErrorHandling } from '../utils/error';
import { useToast } from './toastStore';

interface AppInstallState {
  unifiedInstalls: AppInstallUnified[];
}

interface AppInstallContextType extends AppInstallState {
  fetchAll: () => Promise<void>;
  accept: (contractId: string, installMeta: Metadata, meta: Metadata) => Promise<void>;
  reject: (contractId: string, meta: Metadata) => Promise<void>;
  cancelInstall: (contractId: string, meta: Metadata) => Promise<void>;
  createLicense: (
    contractId: string,
    meta: Metadata,
  ) => Promise<AppInstallCreateLicenseResult | undefined>;
}

const AppInstallContext = createContext<AppInstallContextType | undefined>(undefined);

export const AppInstallProvider = ({ children }: { children: React.ReactNode }) => {
  const [unifiedInstalls, setUnifiedInstalls] = useState<AppInstallUnified[]>([]);
  const { displaySuccess } = useToast();
  const reportFetchAll = useWithErrorHandling('Fetching AppInstall data');
  const reportAccept = useWithErrorHandling('Accepting AppInstallRequest');
  const reportReject = useWithErrorHandling('Rejecting AppInstallRequest');
  const reportCancel = useWithErrorHandling('Canceling AppInstall');
  const reportCreateLicense = useWithErrorHandling('Creating License from AppInstall');

  const fetchAll = useCallback(
    () =>
      reportFetchAll(async () => {
        const client: Client = await api.getClient();
        const requestsResponse = await client.listAppInstallRequests();
        const requests: ApiAppInstallRequest[] = requestsResponse.data;
        const installsResponse = await client.listAppInstalls();
        const installs: ApiAppInstall[] = installsResponse.data as ApiAppInstall[];

        const unifiedRequests: AppInstallUnified[] = requests.map((r) => ({
          status: 'REQUEST',
          contractId: r.contractId,
          provider: r.provider,
          user: r.user,
          meta: r.meta,
          numLicensesCreated: 0,
        }));
        const unifiedInstallRecords: AppInstallUnified[] = installs.map((i) => ({
          status: 'INSTALL',
          contractId: i.contractId,
          provider: i.provider,
          user: i.user,
          meta: i.meta,
          numLicensesCreated: i.numLicensesCreated || 0,
        }));

        setUnifiedInstalls([...unifiedRequests, ...unifiedInstallRecords]);
      })(),
    [reportFetchAll],
  );

  const accept = useCallback(
    (contractId: string, installMeta: Metadata, meta: Metadata) =>
      reportAccept(async () => {
        const client: Client = await api.getClient();
        const commandId = generateCommandId();
        await client.acceptAppInstallRequest({ contractId, commandId }, {
          installMeta,
          meta,
        } as AppInstallRequestAccept);
        await fetchAll();
        displaySuccess(`Accepted AppInstallRequest ${contractId}`);
      })(),
    [reportAccept, displaySuccess, fetchAll],
  );

  const reject = useCallback(
    (contractId: string, meta: Metadata) =>
      reportReject(async () => {
        const client: Client = await api.getClient();
        const commandId = generateCommandId();
        await client.rejectAppInstallRequest({ contractId, commandId }, {
          meta,
        } as AppInstallRequestReject);
        await fetchAll();
        displaySuccess(`Rejected AppInstallRequest ${contractId}`);
      })(),
    [reportReject, displaySuccess, fetchAll],
  );

  const cancelInstall = useCallback(
    (contractId: string, meta: Metadata) =>
      reportCancel(async () => {
        const client: Client = await api.getClient();
        const commandId = generateCommandId();
        await client.cancelAppInstall({ contractId, commandId }, { meta } as AppInstallCancel);
        await fetchAll();
        displaySuccess(`Canceled AppInstall ${contractId}`);
      })(),
    [reportCancel, displaySuccess, fetchAll],
  );

  const createLicense = useCallback(
    (contractId: string, meta: Metadata) =>
      reportCreateLicense(async () => {
        const client: Client = await api.getClient();
        const body: AppInstallCreateLicenseRequest = { params: { meta } };
        const commandId = generateCommandId();
        const response = await client.createLicense({ contractId, commandId }, body);
        await fetchAll();
        displaySuccess(`Created License: ${response.data?.licenseId}`);
        return response.data;
      })(),
    [reportCreateLicense, displaySuccess, fetchAll],
  );

  return (
    <AppInstallContext.Provider
      value={{
        unifiedInstalls,
        fetchAll,
        accept,
        reject,
        cancelInstall,
        createLicense,
      }}
    >
      {children}
    </AppInstallContext.Provider>
  );
};

export const useAppInstallStore = () => {
  const context = useContext(AppInstallContext);
  if (context === undefined) {
    throw new Error('useAppInstallStore must be used within an AppInstallProvider');
  }
  return context;
};
