// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useUserStore } from '../stores/userStore';

/** The classes every nav link shares. The icon is centered in the rail and starts the row in the full sidebar. */
const NAV_LINK =
  'focus-ring flex items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-base transition-colors lg:justify-start';

/** The classes for a nav link: the primary color on the active route, a hover color on the others. */
function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? `${NAV_LINK} bg-primary font-medium text-primary-foreground`
    : `${NAV_LINK} text-foreground-secondary hover:bg-sidebar-hover hover:text-foreground`;
}

/**
 * The app shell's navigation, with the signed-in user at the bottom. Below the `lg` breakpoint it
 * narrows to a rail of icons, and its labels stay for screen readers.
 */
const Sidebar: React.FC = () => {
  const { user, loading, fetchUser, logout } = useUserStore();

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const isProvider = user?.isAdmin ?? false;

  return (
    <aside className="sticky top-0 flex h-screen w-20 shrink-0 flex-col border-r border-border bg-sidebar px-2 py-7 lg:w-64 lg:px-4">
      <Link
        to="/"
        className="focus-ring px-3 text-center text-2xl font-extrabold tracking-tight lg:text-left"
      >
        <span
          aria-hidden="true"
          className="lg:hidden"
        >
          Q
        </span>
        <span className="sr-only lg:not-sr-only">QuickStart</span>
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
            <NavLabel>{isProvider ? 'Installations' : 'Applications'}</NavLabel>
          </NavLink>
          <NavLink
            to="/licenses"
            className={navLinkClass}
          >
            <LicenseIcon />
            <NavLabel>Licenses</NavLabel>
          </NavLink>
          {isProvider && (
            <NavLink
              to="/tenants"
              className={navLinkClass}
            >
              <TenantsIcon />
              <NavLabel>Tenants</NavLabel>
            </NavLink>
          )}
        </nav>
      )}
      <div className="mt-auto text-center lg:px-2 lg:text-left">
        {user ? (
          <div className="flex flex-col items-center gap-2 lg:flex-row lg:gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-current text-label">
              <PersonIcon />
            </span>
            <div className="min-w-0">
              <div className="sr-only lg:not-sr-only">
                <p
                  id="user-name"
                  className="truncate font-semibold leading-tight"
                >
                  {user.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isProvider ? 'App Provider' : 'App User'}
                </p>
              </div>
              <button
                type="button"
                className="focus-ring mt-1 cursor-pointer text-sm text-primary underline hover:text-primary-hover"
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
              className="focus-ring font-medium text-primary hover:text-primary-hover"
            >
              Log in
            </Link>
          )
        )}
      </div>
    </aside>
  );
};

/** A nav link's text. Below `lg` it is visually hidden and stays for screen readers. */
const NavLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="sr-only lg:not-sr-only">{children}</span>
);

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

/** Stacked layers, the icon of Installations. */
const LayersIcon: React.FC = () => (
  <Icon>
    <path d="M12 3 2 8l10 5 10-5-10-5Z" />
    <path d="m2 13 10 5 10-5" />
  </Icon>
);

/** A card with a stripe, the icon of Licenses. */
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

/** Two people, the icon of Tenants. */
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

/** One person, the avatar of the signed-in user. */
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
