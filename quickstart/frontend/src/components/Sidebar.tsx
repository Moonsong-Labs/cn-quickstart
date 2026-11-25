// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useUserStore } from '../stores/userStore';

const NAV_LINK =
  'tw:flex tw:items-center tw:gap-3 tw:rounded-lg tw:px-3 tw:py-2.5 tw:text-base tw:no-underline tw:transition-colors';

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? `${NAV_LINK} tw:bg-brand-700 tw:font-medium tw:text-white tw:hover:text-white`
    : `${NAV_LINK} tw:text-neutral-800 tw:hover:bg-neutral-200 tw:hover:text-neutral-900`;
}

/** The app shell's navigation, with the signed-in user at the bottom. */
const Sidebar: React.FC = () => {
  const { user, loading, fetchUser, logout } = useUserStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const isProvider = user?.isAdmin ?? false;

  return (
    <aside className="tw:sticky tw:top-0 tw:flex tw:h-screen tw:w-64 tw:shrink-0 tw:flex-col tw:border-r tw:border-neutral-200 tw:bg-neutral-100 tw:px-4 tw:py-7">
      <Link
        to="/"
        className="tw:px-3 tw:text-2xl tw:font-extrabold tw:tracking-tight tw:text-neutral-900 tw:no-underline tw:hover:text-neutral-900"
      >
        QuickStart
      </Link>
      {user && (
        <nav
          aria-label="Main"
          className="tw:mt-10 tw:flex tw:flex-col tw:gap-1"
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
      <div className="tw:mt-auto tw:px-2">
        {user ? (
          <div className="tw:flex tw:items-center tw:gap-3">
            <span className="tw:flex tw:size-10 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full tw:border-2 tw:border-neutral-700 tw:text-neutral-700">
              <PersonIcon />
            </span>
            <div className="tw:min-w-0">
              <p
                id="user-name"
                className="tw:mb-0 tw:truncate tw:font-semibold tw:leading-tight"
              >
                {user.name}
              </p>
              <p className="tw:mb-0 tw:text-sm tw:text-neutral-600">
                {isProvider ? 'App Provider' : 'App User'}
              </p>
              <button
                type="button"
                className="tw:mt-1 tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:text-brand-700 tw:underline tw:hover:text-brand-800"
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
              className="tw:font-medium tw:text-brand-700 tw:hover:text-brand-800"
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
