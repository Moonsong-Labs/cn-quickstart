// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';

/** The title band at the top of a page. */
const PageHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <header className="border-b border-neutral-200 px-10 pt-8 pb-6">
    <h1 className="mb-1 text-3xl font-bold tracking-tight">{title}</h1>
    <p className="mb-0 text-neutral-600">{subtitle}</p>
  </header>
);

export default PageHeader;
