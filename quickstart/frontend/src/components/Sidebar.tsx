// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useUserStore } from '../stores/userStore';

const NAV_LINK =
  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-base no-underline transition-colors';

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? `${NAV_LINK} bg-brand-700 font-medium text-white hover:text-white`
    : `${NAV_LINK} text-neutral-800 hover:bg-neutral-200 hover:text-neutral-900`;
}

/** The app shell's navigation, with the signed-in user at the bottom. */
const Sidebar: React.FC = () => {
  const { user, loading, fetchUser, logout } = useUserStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const isProvider = user?.isAdmin ?? false;

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-100 px-4 py-7">
      <Link
        to="/"
        className="px-3 text-2xl font-extrabold tracking-tight text-neutral-900 no-underline hover:text-neutral-900"
      >
        QuickStart
      </Link>
      {user && (
        <nav
          aria-label="Main"
          className="mt-10 flex flex-col gap-1"
        >
          <NavLink
            to="/app-installs"
            className={navLinkClass}
          >
            <LayersIcon />
            {isProvider ? 'Installations' : 'Applications'}
          </NavLink>
          <NavLink
            to="/licenses"
            className={navLinkClass}
          >
            <LicenseIcon />
            Licenses
          </NavLink>
          {isProvider && (
            <NavLink
              to="/tenants"
              className={navLinkClass}
            >
              <TenantsIcon />
              Tenants
            </NavLink>
          )}
        </nav>
      )}
      <div className="mt-auto px-2">
        {user ? (
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-neutral-700 text-neutral-700">
              <PersonIcon />
            </span>
            <div className="min-w-0">
              <p
                id="user-name"
                className="mb-0 truncate font-semibold leading-tight"
              >
                {user.name}
              </p>
              <p className="mb-0 text-sm text-neutral-600">
                {isProvider ? 'App Provider' : 'App User'}
              </p>
              <button
                type="button"
                className="mt-1 border-0 bg-transparent p-0 text-sm text-brand-700 underline hover:text-brand-800"
                onClick={logout}
              >
                Log out
              </button>
            </div>
          </div>
        ) : (
          !loading && (
            <Link
              to="/login"
              className="font-medium text-brand-700 hover:text-brand-800"
            >
              Log in
            </Link>
          )
        )}
      </div>
    </aside>
  );
};

/** A decorative stroke icon. Each nav link names itself in text. */
const Icon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const LayersIcon: React.FC = () => (
  <Icon>
    <path d="M12 3 2 8l10 5 10-5-10-5Z" />
    <path d="m2 13 10 5 10-5" />
  </Icon>
);

const LicenseIcon: React.FC = () => (
  <Icon>
    <rect
      x="3"
      y="5"
      width="18"
      height="14"
      rx="2"
    />
    <path d="M8 5v14" />
  </Icon>
);

const TenantsIcon: React.FC = () => (
  <Icon>
    <circle
      cx="9"
      cy="8"
      r="3.5"
    />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5" />
  </Icon>
);

const PersonIcon: React.FC = () => (
  <Icon>
    <circle
      cx="12"
      cy="8"
      r="4"
    />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);

export default Sidebar;
