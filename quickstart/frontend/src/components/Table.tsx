// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type { ComponentPropsWithoutRef } from 'react';

type TableProps = Omit<ComponentPropsWithoutRef<'table'>, 'className'> & {
  /** `fixed` takes the column widths from the header cells, so long values truncate instead. */
  layout?: 'auto' | 'fixed';
};

/** A data table. It scrolls sideways when its columns are wider than its container. */
export function Table({ layout = 'auto', ...props }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table
        {...props}
        className={`w-full border-collapse text-sm ${layout === 'fixed' ? 'table-fixed' : 'table-auto'}`}
      />
    </div>
  );
}

/** A header cell. A label wider than its column is clipped. */
export function Th(props: Omit<ComponentPropsWithoutRef<'th'>, 'className'>) {
  return (
    <th
      {...props}
      className="overflow-hidden border-b border-border-strong px-2 py-2 text-left font-semibold"
    />
  );
}

const OVERFLOW = {
  wrap: '',
  nowrap: 'whitespace-nowrap',
  truncate: 'truncate',
};

type TdProps = Omit<ComponentPropsWithoutRef<'td'>, 'className'> & {
  /** How a value wider than its column fits: it wraps, stays on one line, or ends with an ellipsis. */
  overflow?: keyof typeof OVERFLOW;
};

/** A body cell. */
export function Td({ overflow = 'wrap', ...props }: TdProps) {
  return (
    <td
      {...props}
      className={`border-b border-border px-2 py-2 align-middle ${OVERFLOW[overflow]}`}
    />
  );
}
