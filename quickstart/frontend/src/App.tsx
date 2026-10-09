// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import './App.css';
import { Route, Routes } from 'react-router-dom';
import Header from './components/Header';
import ToastNotification from './components/ToastNotification';
import { AppInstallProvider } from './stores/appInstallStore.tsx';
import { LicenseProvider } from './stores/licenseStore';
import { TenantRegistrationProvider } from './stores/tenantRegistrationStore.tsx';
import { ToastProvider } from './stores/toastStore';
import { UserProvider } from './stores/userStore';
import AppInstallsView from './views/AppInstallsView.tsx';
import HomeView from './views/HomeView';
import LicensesView from './views/LicensesView';
import LoginView from './views/LoginView';
import TenantRegistrationView from './views/TenantRegistrationView.tsx';

const App: React.FC = () => {
  const AppProviders = composeProviders(
    ToastProvider,
    UserProvider,
    TenantRegistrationProvider,
    AppInstallProvider,
    LicenseProvider,
  );

  return (
    <AppProviders>
      <Header />
      <main className="container mt-4">
        <Routes>
          <Route
            path="/"
            element={<HomeView />}
          />
          <Route
            path="/tenants"
            element={<TenantRegistrationView />}
          />
          <Route
            path="/login"
            element={<LoginView />}
          />
          <Route
            path="/app-installs"
            element={<AppInstallsView />}
          />
          <Route
            path="/licenses"
            element={<LicensesView />}
          />
        </Routes>
      </main>
      <ToastNotification />
    </AppProviders>
  );
};

const composeProviders = (...providers: React.ComponentType<{ children: React.ReactNode }>[]) => {
  return providers.reduce(
    (AccumulatedProviders, CurrentProvider) => {
      return ({ children }: { children: React.ReactNode }) => (
        <AccumulatedProviders>
          <CurrentProvider>{children}</CurrentProvider>
        </AccumulatedProviders>
      );
    },
    ({ children }: { children: React.ReactNode }) => <>{children}</>,
  );
};

export default App;
