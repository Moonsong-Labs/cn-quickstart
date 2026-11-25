// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, type ButtonVariant } from './Button';
import { CloseButton } from './CloseButton';
import { makeOthersInert } from './dialogLayer';

const DIALOG_WIDTH = {
  lg: 'max-w-3xl',
  xl: 'max-w-6xl',
};

type ModalProps = {
  show: boolean;
  title: string;
  onClose: () => void;
  /** Runs when the footer button is pressed. Without it, the footer button closes the dialog. */
  onConfirm?: () => void;
  children?: ReactNode;
  size?: keyof typeof DIALOG_WIDTH;
  confirmVariant?: ButtonVariant;
  confirmButtonLabel?: string;
  confirmButtonDisabled?: boolean;
};

/**
 * A modal dialog above the page. While it is open, the rest of the page is inert, so Tab, pointer
 * input and screen readers cannot reach the page behind it. Escape closes the topmost dialog only,
 * wherever focus is. When the dialog closes, focus goes back to the control that opened it.
 */
export default function Modal({
  show,
  title,
  onClose,
  onConfirm,
  children,
  size = 'lg',
  confirmVariant = 'secondary',
  confirmButtonLabel = 'Close',
  confirmButtonDisabled = false,
}: ModalProps) {
  const titleId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!show || !layer) return;
    const opener = document.activeElement;
    const restoreOthers = makeOthersInert(layer);
    // Focus the panel, not a control, so a screen reader reads the title first.
    panelRef.current?.focus();
    return () => {
      restoreOthers();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [show]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!show || !layer) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only the topmost dialog is not inert. Stopping the event keeps an older dialog's listener,
      // which may run next, from closing that dialog too.
      if (event.key !== 'Escape' || layer.hasAttribute('inert')) return;
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose]);

  if (!show) return null;

  return createPortal(
    <div
      ref={layerRef}
      className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-overlay p-4"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`my-auto w-full rounded-xl bg-background shadow-xl outline-none ${DIALOG_WIDTH[size]}`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <h2
            id={titleId}
            className="text-lg font-semibold"
          >
            {title}
          </h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="px-6 py-5">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button
            variant={confirmVariant}
            disabled={confirmButtonDisabled}
            onClick={onConfirm ?? onClose}
          >
            {confirmButtonLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
