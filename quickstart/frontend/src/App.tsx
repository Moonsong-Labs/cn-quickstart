// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import './App.css';
import { Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
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
      <div className="tw:flex tw:min-h-screen tw:bg-white tw:font-sans tw:text-neutral-900">
        <Sidebar />
        <main className="tw:min-w-0 tw:flex-1">
          <Routes>
            <Route
              path="/"
              element={
                <BootstrapPage>
                  <HomeView />
                </BootstrapPage>
              }
            />
            <Route
              path="/tenants"
              element={
                <BootstrapPage>
                  <TenantRegistrationView />
                </BootstrapPage>
              }
            />
            <Route
              path="/login"
              element={
                <BootstrapPage>
                  <LoginView />
                </BootstrapPage>
              }
            />
            <Route
              path="/app-installs"
              element={<AppInstallsView />}
            />
            <Route
              path="/licenses"
              element={
                <BootstrapPage>
                  <LicensesView />
                </BootstrapPage>
              }
            />
          </Routes>
        </main>
      </div>
      <ToastNotification />
    </AppProviders>
  );
};

/** The Bootstrap container that the views not yet redesigned lay out in. */
const BootstrapPage = ({ children }: { children: React.ReactNode }) => (
  <div className="container mt-4">{children}</div>
);

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
