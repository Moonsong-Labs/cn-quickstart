// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { ComponentPropsWithoutRef, ReactNode } from 'react';

const CONTROL =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-2 focus:outline-brand-600/30';

/** The text of a form control, tied to it through `htmlFor`. */
export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-sm font-medium text-neutral-700"
    >
      {children}
    </label>
  );
}

/** A text or number input. It fills its container, so the container sets its width. */
export function Input(props: Omit<ComponentPropsWithoutRef<'input'>, 'className'>) {
  return (
    <input
      {...props}
      className={CONTROL}
    />
  );
}

/** A select. It fills its container, so the container sets its width. */
export function Select(props: Omit<ComponentPropsWithoutRef<'select'>, 'className'>) {
  return (
    <select
      {...props}
      className={CONTROL}
    />
  );
}
