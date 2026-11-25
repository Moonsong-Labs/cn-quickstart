// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { ComponentPropsWithoutRef, ReactNode } from 'react';

/** How a button reads: the main action, a neutral one, or one that removes something. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export type ButtonSize = 'md' | 'lg';

interface ButtonStyle {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BASE =
  'focus-ring inline-flex cursor-pointer items-center justify-center rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const SIZE: Record<ButtonSize, string> = {
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-base',
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover',
  secondary: 'border-border-strong bg-background text-foreground-secondary hover:bg-muted',
  danger: 'border-danger-border bg-background text-danger hover:bg-danger-subtle',
};

function buttonClassName({ variant = 'secondary', size = 'md' }: ButtonStyle) {
  return `${BASE} ${SIZE[size]} ${VARIANT[variant]}`;
}

type ButtonProps = ButtonStyle & Omit<ComponentPropsWithoutRef<'button'>, 'className'>;

/** A button in one of the app's variants. It defaults to `type="button"`, so it submits a form only when asked to. */
export function Button({ variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={buttonClassName({ variant, size })}
    />
  );
}

type ButtonLinkProps = ButtonStyle &
  Omit<ComponentPropsWithoutRef<'a'>, 'className' | 'href' | 'children'> & {
    href: string;
    children: ReactNode;
  };

/** A link that looks like a button, for navigation that leaves the app, such as a sign-in redirect. */
export function ButtonLink({ variant, size, href, children, ...props }: ButtonLinkProps) {
  return (
    <a
      {...props}
      href={href}
      className={buttonClassName({ variant, size })}
    >
      {children}
    </a>
  );
}
