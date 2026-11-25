// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { ReactNode } from 'react';

/** A page with a title band above its content. */
export function Page({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border px-10 pt-8 pb-6">
        <h1 className="mb-1 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </header>
      {children}
    </div>
  );
}

/** The padded content area of a page. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="px-10 py-8">{children}</div>;
}
