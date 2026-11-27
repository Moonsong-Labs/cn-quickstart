// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { ReactNode } from 'react';

const TONE = {
  primary: 'bg-primary text-primary-foreground',
  neutral: 'bg-muted text-label',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
};

const SHAPE = {
  tag: 'rounded-md px-2.5 py-1 font-medium',
  pill: 'rounded-full px-2.5 py-0.5 font-semibold',
};

/** A short status label on one line. It keeps its width in a flex row. */
export function Badge({
  tone,
  shape = 'tag',
  children,
}: {
  tone: keyof typeof TONE;
  shape?: keyof typeof SHAPE;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block shrink-0 text-sm whitespace-nowrap ${SHAPE[shape]} ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
