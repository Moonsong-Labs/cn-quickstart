// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect, useState } from 'react';
import api from '../api';
import { Button, ButtonLink } from '../components/Button';
import { Input, Label } from '../components/Form';
import PageHeader from '../components/PageHeader';
import type { Client, FeatureFlags, LoginLink } from '../openapi';
import { useToast } from '../stores/toastStore';

const LoginView: React.FC = () => {
  const [loginLinks, setLoginLinks] = useState<LoginLink[]>([]);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);
  const { displayError } = useToast();

  useEffect(() => {
    const fetchLoginLinks = async () => {
      try {
        const client: Client = await api.getClient();
        const response = await client.listLinks();
        setLoginLinks(response.data);
      } catch {
        displayError('Error fetching login links');
      }
    };
    const fetchFeatureFlags = async () => {
      try {
        const client: Client = await api.getClient();
        const response = await client.getFeatureFlags();
        setFeatureFlags(response.data);
        if (response.data.authMode === 'oauth2') {
          await fetchLoginLinks();
        }
      } catch {
        displayError('Error fetching feature flags');
      }
    };
    void fetchFeatureFlags();
  }, [displayError]);

  const isOAuth2 = featureFlags?.authMode === 'oauth2';

  return (
    <>
      <PageHeader
        title="Login"
        subtitle={isOAuth2 ? 'Login with OAuth 2.0' : 'Login with a shared secret'}
      />
      <div className="px-10 py-8">
        {isOAuth2 ? (
          <ul className="flex max-w-sm flex-col gap-2">
            {loginLinks.map((link) => (
              <li
                key={link.url}
                className="grid"
              >
                <ButtonLink
                  size="lg"
                  href={link.url}
                >
                  {link.name}
                </ButtonLink>
              </li>
            ))}
          </ul>
        ) : (
          <form
            name="f"
            action="login/shared-secret"
            method="POST"
            className="flex max-w-md items-end gap-3"
          >
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="username">User:</Label>
              <Input
                type="text"
                id="username"
                name="username"
              />
            </div>
            <Button
              type="submit"
              name="submit"
              variant="primary"
            >
              Sign in
            </Button>
          </form>
        )}
        <div className="mt-6 text-sm text-neutral-600">
          <div>AppProvider user: app-provider{isOAuth2 && ', password: abc123'}</div>
          <div>AppUser user: app-user{isOAuth2 && ', password: abc123'}</div>
        </div>
      </div>
    </>
  );
};

export default LoginView;
