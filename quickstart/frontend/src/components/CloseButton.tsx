// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

const TONE = {
  neutral: 'text-subtle-foreground hover:bg-muted hover:text-foreground',
  inverse: 'text-inverse/80 hover:bg-inverse/10 hover:text-inverse',
};

/** The × button that closes a dialog or a notification. `inverse` sits on a dark background. */
export function CloseButton({
  onClick,
  tone = 'neutral',
}: {
  onClick: () => void;
  tone?: keyof typeof TONE;
}) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClick}
      className={`focus-ring cursor-pointer rounded-md p-1 ${TONE[tone]}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M3 3l10 10M13 3 3 13" />
      </svg>
    </button>
  );
}
