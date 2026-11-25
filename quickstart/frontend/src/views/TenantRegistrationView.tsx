// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import { buttonClass, FIELD, LABEL, TABLE } from '../components/controls';
import PageHeader from '../components/PageHeader';
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
          className="max-w-2xl"
          onSubmit={handleSubmit}
        >
          <div className="mb-3">
            <label
              htmlFor="tenantId"
              className={`${LABEL} mb-1 block`}
            >
              Tenant ID:
            </label>
            <input
              type="text"
              id="tenantId"
              name="tenantId"
              className={`${FIELD} w-full`}
              value={formData.tenantId}
              onChange={handleChange}
              required
            />
          </div>
          <div className="mb-3">
            <label
              htmlFor="partyId"
              className={`${LABEL} mb-1 block`}
            >
              PartyId:
            </label>
            <input
              type="text"
              id="partyId"
              name="partyId"
              className={`${FIELD} w-full`}
              value={formData.partyId}
              onChange={handleChange}
              required
            />
          </div>
          {featureFlags?.authMode === 'oauth2' && (
            <>
              <div className="mb-3">
                <label
                  htmlFor="clientId"
                  className={`${LABEL} mb-1 block`}
                >
                  Client ID:
                </label>
                <input
                  type="text"
                  id="clientId"
                  name="clientId"
                  className={`${FIELD} w-full`}
                  value={formData.clientId}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="mb-3">
                <label
                  htmlFor="issuerUrl"
                  className={`${LABEL} mb-1 block`}
                >
                  Issuer URL:
                </label>
                <input
                  type="text"
                  id="issuerUrl"
                  name="issuerUrl"
                  className={`${FIELD} w-full`}
                  value={formData.issuerUrl}
                  onChange={handleChange}
                  required
                />
              </div>
            </>
          )}
          <div className="mb-3">
            <label
              htmlFor="walletUrl"
              className={`${LABEL} mb-1 block`}
            >
              Wallet URL:
            </label>
            <input
              type="text"
              id="walletUrl"
              name="walletUrl"
              className={`${FIELD} w-full`}
              value={formData.walletUrl}
              onChange={handleChange}
            />
          </div>
          {featureFlags?.authMode === 'shared-secret' && (
            <div className="mb-3">
              <label
                htmlFor="users"
                className={`${LABEL} mb-1 block`}
              >
                Users (comma-separated):
              </label>
              <input
                type="text"
                id="users"
                name="users"
                className={`${FIELD} w-full`}
                value={
                  Array.isArray(formData.users) ? formData.users.join(', ') : (formData.users ?? '')
                }
                onChange={handleChange}
              />
            </div>
          )}
          <button
            type="submit"
            className={buttonClass('primary')}
          >
            Submit
          </button>
        </form>

        <div className="mt-4">
          <h3 className="mb-3 text-xl font-bold">Existing Tenant Registrations</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={`${TABLE.th} whitespace-nowrap`}>Tenant ID</th>
                  <th className={`${TABLE.th} whitespace-nowrap`}>Party ID</th>
                  {featureFlags?.authMode === 'oauth2' && (
                    <>
                      <th className={`${TABLE.th} whitespace-nowrap`}>Client ID</th>
                      <th className={`${TABLE.th} whitespace-nowrap`}>Issuer URL</th>
                    </>
                  )}
                  <th className={`${TABLE.th} whitespace-nowrap`}>Wallet URL</th>
                  {featureFlags?.authMode === 'shared-secret' && (
                    <th className={`${TABLE.th} whitespace-nowrap`}>Users</th>
                  )}
                  <th className={`${TABLE.th} whitespace-nowrap`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((registration) => (
                  <tr key={registration.tenantId}>
                    <td className={`${TABLE.td} whitespace-nowrap`}>{registration.tenantId}</td>
                    <td className={`${TABLE.td} whitespace-nowrap`}>{registration.partyId}</td>
                    {featureFlags?.authMode === 'oauth2' && (
                      <>
                        <td className={`${TABLE.td} whitespace-nowrap`}>{registration.clientId}</td>
                        <td className={`${TABLE.td} whitespace-nowrap`}>
                          {registration.issuerUrl}
                        </td>
                      </>
                    )}
                    <td className={`${TABLE.td} whitespace-nowrap`}>{registration.walletUrl}</td>
                    {featureFlags?.authMode === 'shared-secret' && (
                      <td className={`${TABLE.td} whitespace-nowrap`}>{registration.users}</td>
                    )}
                    <td className={`${TABLE.td} whitespace-nowrap`}>
                      <button
                        type="button"
                        className={buttonClass('danger')}
                        disabled={registration.internal}
                        onClick={() => handleDelete(registration.tenantId)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TenantRegistrationView;
