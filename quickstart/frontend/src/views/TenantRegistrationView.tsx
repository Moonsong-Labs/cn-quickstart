// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { Button } from '../components/Button';
import { Input, Label } from '../components/Form';
import PageHeader from '../components/PageHeader';
import { Table, Td, Th } from '../components/Table';
import type { Client, FeatureFlags } from '../openapi';
import type { TenantRegistrationRequest } from '../openapi.d.ts';
import { useTenantRegistrationStore } from '../stores/tenantRegistrationStore';
import { useToast } from '../stores/toastStore';

const TenantRegistrationView: React.FC = () => {
  const {
    registrations,
    fetchTenantRegistrations,
    createTenantRegistration,
    deleteTenantRegistration,
  } = useTenantRegistrationStore();

  const [formData, setFormData] = useState<TenantRegistrationRequest>({
    tenantId: '',
    partyId: '',
    clientId: '',
    issuerUrl: '',
    walletUrl: '',
    users: [],
  });

  const { displayError } = useToast();
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);

  const fetchFeatureFlags = useCallback(async () => {
    try {
      const client: Client = await api.getClient();
      const response = await client.getFeatureFlags();
      setFeatureFlags(response.data);
    } catch {
      displayError('Error fetching feature flags');
    }
  }, [displayError]);

  useEffect(() => {
    void fetchFeatureFlags();
    void fetchTenantRegistrations();
  }, [fetchFeatureFlags, fetchTenantRegistrations]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'users' ? value.split(',').map((user) => user.trim()) : value,
    }));
  };

  // Validation driven by feature flags
  const validate = (): string | null => {
    const t = formData.tenantId.trim();
    const p = formData.partyId.trim();
    if (!t) return 'Tenant ID is required';
    if (!p) return 'Party ID is required';

    if (featureFlags?.authMode === 'oauth2') {
      if (!formData.clientId?.trim()) return 'Client ID is required (OAuth2)';
      if (!formData.issuerUrl?.trim()) return 'Issuer URL is required (OAuth2)';
    }

    if (featureFlags?.authMode === 'shared-secret') {
      if (!formData.users || formData.users.length === 0) {
        return 'At least one user is required (Shared Secret)';
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validate();
    if (error) {
      displayError(error);
      return;
    }
    await createTenantRegistration(formData);
    setFormData({
      tenantId: '',
      partyId: '',
      clientId: '',
      issuerUrl: '',
      walletUrl: '',
      users: [],
    });
  };

  const handleDelete = async (tenantId: string) => {
    if (window.confirm('Are you sure you want to delete this tenant registration?')) {
      await deleteTenantRegistration(tenantId);
    }
  };

  return (
    <div>
      <PageHeader
        title="Tenants"
        subtitle="Tenant registrations"
      />
      <div className="px-10 py-8">
        <form
          className="flex max-w-2xl flex-col gap-3"
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="tenantId">Tenant ID:</Label>
            <Input
              type="text"
              id="tenantId"
              name="tenantId"
              value={formData.tenantId}
              onChange={handleChange}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="partyId">PartyId:</Label>
            <Input
              type="text"
              id="partyId"
              name="partyId"
              value={formData.partyId}
              onChange={handleChange}
              required
            />
          </div>
          {featureFlags?.authMode === 'oauth2' && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="clientId">Client ID:</Label>
                <Input
                  type="text"
                  id="clientId"
                  name="clientId"
                  value={formData.clientId}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="issuerUrl">Issuer URL:</Label>
                <Input
                  type="text"
                  id="issuerUrl"
                  name="issuerUrl"
                  value={formData.issuerUrl}
                  onChange={handleChange}
                  required
                />
              </div>
            </>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="walletUrl">Wallet URL:</Label>
            <Input
              type="text"
              id="walletUrl"
              name="walletUrl"
              value={formData.walletUrl}
              onChange={handleChange}
            />
          </div>
          {featureFlags?.authMode === 'shared-secret' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="users">Users (comma-separated):</Label>
              <Input
                type="text"
                id="users"
                name="users"
                value={
                  Array.isArray(formData.users) ? formData.users.join(', ') : (formData.users ?? '')
                }
                onChange={handleChange}
              />
            </div>
          )}
          <div>
            <Button
              type="submit"
              variant="primary"
            >
              Submit
            </Button>
          </div>
        </form>

        <div className="mt-4">
          <h3 className="mb-3 text-xl font-bold">Existing Tenant Registrations</h3>
          <Table>
            <thead>
              <tr>
                <Th>Tenant ID</Th>
                <Th>Party ID</Th>
                {featureFlags?.authMode === 'oauth2' && (
                  <>
                    <Th>Client ID</Th>
                    <Th>Issuer URL</Th>
                  </>
                )}
                <Th>Wallet URL</Th>
                {featureFlags?.authMode === 'shared-secret' && <Th>Users</Th>}
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((registration) => (
                <tr key={registration.tenantId}>
                  <Td overflow="nowrap">{registration.tenantId}</Td>
                  <Td overflow="nowrap">{registration.partyId}</Td>
                  {featureFlags?.authMode === 'oauth2' && (
                    <>
                      <Td overflow="nowrap">{registration.clientId}</Td>
                      <Td overflow="nowrap">{registration.issuerUrl}</Td>
                    </>
                  )}
                  <Td overflow="nowrap">{registration.walletUrl}</Td>
                  {featureFlags?.authMode === 'shared-secret' && (
                    <Td overflow="nowrap">{registration.users}</Td>
                  )}
                  <Td overflow="nowrap">
                    <Button
                      variant="danger"
                      disabled={registration.internal}
                      onClick={() => handleDelete(registration.tenantId)}
                    >
                      Delete
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default TenantRegistrationView;
