// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

const STAYS_INTERACTIVE_ATTRIBUTE = 'data-stays-interactive';

/** Spread on a child of `document.body` that stays usable while a dialog is open, such as notifications. */
export const staysInteractive = { [STAYS_INTERACTIVE_ATTRIBUTE]: '' } as const;

/**
 * Makes every other child of `document.body` inert, so focus, pointer input and screen readers stay
 * in `layer`. Returns a function that undoes only what this call changed, so nested dialogs unwind
 * in order.
 */
export function makeOthersInert(layer: Element): () => void {
  const changed = Array.from(document.body.children).filter(
    (element) =>
      element !== layer &&
      !element.hasAttribute('inert') &&
      !element.hasAttribute(STAYS_INTERACTIVE_ATTRIBUTE),
  );
  for (const element of changed) element.setAttribute('inert', '');
  return () => {
    for (const element of changed) element.removeAttribute('inert');
  };
}
