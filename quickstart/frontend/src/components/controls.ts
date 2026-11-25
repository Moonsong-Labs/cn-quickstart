// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

/** How a button reads: the main action, a neutral one, or one that removes something. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-brand-700 bg-brand-700 text-white hover:bg-brand-800',
  secondary: 'border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100',
  danger: 'border-red-300 bg-white text-red-700 hover:bg-red-50',
};

const BUTTON_SIZE = {
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-base',
};

/** Tailwind classes for a button, shared by every view. */
export function buttonClass(variant: ButtonVariant, size: keyof typeof BUTTON_SIZE = 'md') {
  return `inline-flex cursor-pointer items-center justify-center rounded-lg border font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]}`;
}

/** Tailwind classes for a text input or a select. */
export const FIELD =
  'rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-2 focus:outline-brand-600/30';

/** Tailwind classes for a form field's label. */
export const LABEL = 'text-sm font-medium text-neutral-700';

/** Tailwind classes for a data table and its cells. */
export const TABLE = {
  table: 'w-full table-fixed border-collapse text-sm',
  th: 'overflow-hidden border-b border-neutral-300 px-2 py-2 text-left font-semibold',
  td: 'border-b border-neutral-200 px-2 py-2 align-middle',
};

/** A red mark after a date whose deadline has passed. */
export const DEADLINE_PASSED = "after:ml-1 after:font-bold after:text-red-600 after:content-['!']";
