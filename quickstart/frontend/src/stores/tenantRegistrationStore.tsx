// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import api from '../api.ts';
import type { Client, TenantRegistration, TenantRegistrationRequest } from '../openapi.d.ts';
import { useWithErrorHandling } from '../utils/error';
import { useToast } from './toastStore';

interface TenantRegistrationState {
  registrations: TenantRegistration[];
}

interface TenantRegistrationContextType extends TenantRegistrationState {
  fetchTenantRegistrations: () => Promise<void>;
  createTenantRegistration: (registration: TenantRegistrationRequest) => Promise<void>;
  deleteTenantRegistration: (tenantId: string) => Promise<void>;
  setRegistrations: React.Dispatch<React.SetStateAction<TenantRegistration[]>>;
}

interface TenantRegistrationProviderProps {
  children: React.ReactNode;
}

const TenantRegistrationContext = createContext<TenantRegistrationContextType | undefined>(
  undefined,
);

export const TenantRegistrationProvider = ({ children }: TenantRegistrationProviderProps) => {
  const [registrations, setRegistrations] = useState<TenantRegistration[]>([]);
  const { displaySuccess } = useToast();
  const reportFetch = useWithErrorHandling('Fetching Tenant Registrations');
  const reportCreate = useWithErrorHandling('Creating Tenant Registration');
  const reportDelete = useWithErrorHandling('Deleting Tenant Registration');

  const fetchTenantRegistrations = useCallback(
    () =>
      reportFetch(async () => {
        const client: Client = await api.getClient();
        const response = await client.listTenantRegistrations();
        setRegistrations(response.data);
      })(),
    [reportFetch],
  );

  const createTenantRegistration = useCallback(
    (request: TenantRegistrationRequest) =>
      reportCreate(async () => {
        const client: Client = await api.getClient();
        const response = await client.createTenantRegistration({}, request);
        const created = response.data;
        if (created?.tenantId) {
          setRegistrations((prev) => {
            if (
              prev.some(
                (reg) => reg.tenantId === created.tenantId || reg.clientId === created.clientId,
              )
            )
              return prev;
            return [...prev, created];
          });
        } else {
          const list = await client.listTenantRegistrations();
          setRegistrations(list.data);
        }
        displaySuccess('Tenant registration created');
      })(),
    [reportCreate, displaySuccess],
  );

  const deleteTenantRegistration = useCallback(
    (tenantId: string) =>
      reportDelete(async () => {
        const client: Client = await api.getClient();
        await client.deleteTenantRegistration({ tenantId: tenantId });
        setRegistrations((prev) => prev.filter((reg) => reg.tenantId !== tenantId));
        displaySuccess('Tenant registration deleted');
      })(),
    [reportDelete, displaySuccess],
  );

  return (
    <TenantRegistrationContext.Provider
      value={{
        registrations,
        setRegistrations,
        fetchTenantRegistrations,
        createTenantRegistration,
        deleteTenantRegistration,
      }}
    >
      {children}
    </TenantRegistrationContext.Provider>
  );
};

export const useTenantRegistrationStore = () => {
  const context = useContext(TenantRegistrationContext);
  if (context === undefined) {
    throw new Error('useTenantRegistrationStore must be used within a TenantRegistrationProvider');
  }
  return context;
};
