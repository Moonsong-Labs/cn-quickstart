// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import api from '../api';
import type {
  Client,
  CompleteLicenseRenewalRequest,
  License,
  LicenseRenewalResult,
  LicenseRenewRequest,
  Metadata,
} from '../openapi.d.ts';
import { generateCommandId } from '../utils/commandId';
import { useWithErrorHandling } from '../utils/error';
import { useToast } from './toastStore';

/**
 * The core shape of the License-related application state.
 */
interface LicenseState {
  licenses: License[];
}

/**
 * Methods for retrieving and modifying License data throughout the application.
 */
interface LicenseContextType extends LicenseState {
  fetchLicenses: () => Promise<void>;
  renewLicense: (contractId: string, request: LicenseRenewRequest) => Promise<void>;
  expireLicense: (contractId: string, meta: Metadata) => Promise<void>;
  completeLicenseRenewal: (
    contractId: string,
    renewalRequestContractId: string,
    allocationContractId: string,
  ) => Promise<LicenseRenewalResult | undefined>;
  withdrawLicenseRenewalRequest: (contractId: string) => Promise<void>;
  initiateLicenseRenewal: (contractId: string, request: LicenseRenewRequest) => Promise<void>;
  initiateLicenseExpiration: (contractId: string, description: string) => Promise<void>;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

/**
 * Provides shared License state and actions to manage Licenses and their renewals.
 */
export const LicenseProvider = ({ children }: { children: React.ReactNode }) => {
  const [licenses, setLicenses] = useState<License[]>([]);
  const { displaySuccess } = useToast();
  const reportFetchLicenses = useWithErrorHandling('Fetching Licenses');
  const reportRenewLicense = useWithErrorHandling('Renewing License');
  const reportExpireLicense = useWithErrorHandling('Archiving License');
  const reportCompleteRenewal = useWithErrorHandling('Completing License Renewal');
  const reportWithdrawRenewal = useWithErrorHandling('Withdrawing License renewal request');
  const reportInitiateRenewal = useWithErrorHandling('Initiate License Renewal');
  const reportInitiateExpiration = useWithErrorHandling('Initiate License Expiration');

  /**
   * Fetches all Licenses from the backend, including any associated renewal requests.
   */
  const fetchLicenses = useCallback(
    () =>
      reportFetchLicenses(async () => {
        const client: Client = await api.getClient();
        const response = await client.listLicenses();
        setLicenses(response.data);
      })(),
    [reportFetchLicenses],
  );

  /**
   * Sends a request to renew a specific License, optionally refreshing the License list on success.
   */
  const renewLicense = useCallback(
    (contractId: string, request: LicenseRenewRequest) =>
      reportRenewLicense(async () => {
        const client: Client = await api.getClient();
        const commandId = generateCommandId();
        await client.renewLicense({ contractId, commandId }, request);
        await fetchLicenses();
        displaySuccess('License Renewal initiated successfully');
      })(),
    [reportRenewLicense, fetchLicenses, displaySuccess],
  );

  /**
   * Sends a request to expire a specific License, optionally refreshing the License list on success.
   */
  const expireLicense = useCallback(
    (contractId: string, meta: Metadata) =>
      reportExpireLicense(async () => {
        const client: Client = await api.getClient();
        const commandId = generateCommandId();
        await client.expireLicense({ contractId, commandId }, { meta });
        await fetchLicenses();
        displaySuccess('License archived successfully');
      })(),
    [reportExpireLicense, fetchLicenses, displaySuccess],
  );

  /**
   * Completes the renewal flow after the renewal request has been paid.
   */
  const completeLicenseRenewal = useCallback(
    (contractId: string, renewalRequestContractId: string, allocationContractId: string) =>
      reportCompleteRenewal(async () => {
        const client: Client = await api.getClient();
        const commandId = generateCommandId();

        const request: CompleteLicenseRenewalRequest = {
          renewalRequestContractId: renewalRequestContractId,
          allocationContractId: allocationContractId,
        };

        const result = await client.completeLicenseRenewal({ contractId, commandId }, request);
        await fetchLicenses();
        displaySuccess('License renewal completed successfully');
        return result.data;
      })(),
    [reportCompleteRenewal, fetchLicenses, displaySuccess],
  );

  /**
   * Sends a request to withdraw a specific License renewal request.
   */
  const withdrawLicenseRenewalRequest = useCallback(
    (contractId: string) =>
      reportWithdrawRenewal(async () => {
        const client: Client = await api.getClient();
        const commandId = generateCommandId();
        await client.withdrawLicenseRenewalRequest({ contractId, commandId });
        await fetchLicenses();
        displaySuccess('License renewal request withdrawn successfully');
      })(),
    [reportWithdrawRenewal, fetchLicenses, displaySuccess],
  );

  /**
   * Helper to initiate a new License renewal with fixed parameters.
   */
  const initiateLicenseRenewal = useCallback(
    (contractId: string, request: LicenseRenewRequest) =>
      reportInitiateRenewal(async () => {
        await renewLicense(contractId, request);
      })(),
    [reportInitiateRenewal, renewLicense],
  );

  /**
   * Helper to begin the License expiration process with a basic description.
   */
  const initiateLicenseExpiration = useCallback(
    (contractId: string, description: string) =>
      reportInitiateExpiration(async () => {
        const meta = {
          data: { description: description.trim() },
        };
        await expireLicense(contractId, meta);
      })(),
    [reportInitiateExpiration, expireLicense],
  );

  return (
    <LicenseContext.Provider
      value={{
        licenses,
        fetchLicenses,
        renewLicense,
        expireLicense,
        completeLicenseRenewal,
        withdrawLicenseRenewalRequest,
        initiateLicenseRenewal,
        initiateLicenseExpiration,
      }}
    >
      {children}
    </LicenseContext.Provider>
  );
};

/**
 * Hook for accessing License context within React components.
 */
export const useLicenseStore = () => {
  const context = useContext(LicenseContext);
  if (context === undefined) {
    throw new Error('useLicenseStore must be used within a LicenseProvider');
  }
  return context;
};
