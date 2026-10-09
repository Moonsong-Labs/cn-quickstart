// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { isAxiosError } from 'axios';
import type React from 'react';
import { createContext, useCallback, useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import type { AuthenticatedUser, Client } from '../openapi.d.ts';
import { useToast } from './toastStore';

interface UserContextType {
  user: AuthenticatedUser | null;
  loading: boolean;
  fetchUser: () => Promise<void>;
  clearUser: () => void;
  logout: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const { displayError } = useToast();
  const navigate = useNavigate();

  const fetchUser = useCallback(async () => {
    setLoading(true);
    try {
      const client: Client = await api.getClient();
      const response = await client.getAuthenticatedUser();
      setUser(response.data);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        setUser(null);
      } else {
        displayError('Error fetching user');
      }
    } finally {
      setLoading(false);
    }
  }, [displayError]);

  const clearUser = useCallback(() => {
    setUser(null);
  }, []);

  const logout = useCallback(async () => {
    const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
    const csrfToken = match ? decodeURIComponent(match[1]) : '';
    try {
      const response = await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': csrfToken,
        },
      });
      if (response.ok) {
        clearUser();
        void navigate('/');
      } else {
        displayError('Error logging out');
      }
    } catch {
      displayError('Error logging out');
    }
  }, [clearUser, displayError, navigate]);

  return (
    <UserContext.Provider value={{ user, loading, fetchUser, clearUser, logout }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUserStore = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
