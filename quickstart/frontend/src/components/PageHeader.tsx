// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';

/** The title band at the top of a redesigned page. */
const PageHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <header className="tw:border-b tw:border-neutral-200 tw:px-10 tw:pt-8 tw:pb-6">
    <h1 className="tw:mb-1 tw:text-3xl tw:font-bold tw:tracking-tight">{title}</h1>
    <p className="tw:mb-0 tw:text-neutral-600">{subtitle}</p>
  </header>
);

export default PageHeader;
