// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { type ComponentPropsWithoutRef, createContext, type ReactNode, useContext } from 'react';

type Size = 'md' | 'sm';

const SizeContext = createContext<Size>('md');

const LIST: Record<Size, string> = {
  md: 'gap-y-3',
  sm: 'gap-x-4 gap-y-2 text-sm',
};

const CODE: Record<Size, string> = {
  md: 'text-sm leading-6',
  sm: 'text-xs leading-5',
};

/** Rows of terms and their values in two aligned columns. Below `sm`, each term sits above its value. */
export function DescriptionList({ size = 'md', children }: { size?: Size; children: ReactNode }) {
  return (
    <SizeContext.Provider value={size}>
      <dl className={`grid grid-cols-1 sm:grid-cols-[10rem_1fr] ${LIST[size]}`}>{children}</dl>
    </SizeContext.Provider>
  );
}

type DescriptionItemProps = Omit<ComponentPropsWithoutRef<'dd'>, 'className'> & {
  term: ReactNode;
  /** Set the value in a monospace font, for identifiers and raw data. */
  code?: boolean;
};

/** One row of a `DescriptionList`. */
export function DescriptionItem({ term, code = false, ...props }: DescriptionItemProps) {
  const size = useContext(SizeContext);
  return (
    <div className="sm:contents">
      <dt className="text-muted-foreground">{term}</dt>
      <dd
        {...props}
        className={`mt-0.5 sm:mt-0 ${code ? `font-mono break-all ${CODE[size]}` : 'break-words'}`}
      />
    </div>
  );
}
