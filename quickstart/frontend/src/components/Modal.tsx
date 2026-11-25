import type React from 'react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, type ButtonVariant } from './Button';
import { CloseButton } from './CloseButton';

type ModalProps = {
  show: boolean;
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  children?: React.ReactNode; // body content
  footer?: React.ReactNode; // optional footer; default renders a Close button
  size?: keyof typeof DIALOG_WIDTH;
  centered?: boolean; // center vertically
  confirmVariant?: ButtonVariant;
  confirmButtonLabel?: string;
  confirmButtonDisabled?: boolean;
};

const DIALOG_WIDTH = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
  xl: 'max-w-6xl',
};

export default function Modal({
  show,
  title,
  onClose,
  onConfirm,
  children,
  footer,
  size = 'md',
  centered = true,
  confirmVariant = 'secondary',
  confirmButtonLabel = 'Close',
  confirmButtonDisabled = false,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel rather than a control, so a screen reader reads the title first.
  useEffect(() => {
    if (!show) return;
    const opener = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [show]);

  useEffect(() => {
    if (!show) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose]);

  if (!show) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-50 bg-overlay" />
      <div
        className={`fixed inset-0 z-50 flex justify-center overflow-y-auto p-4 ${centered ? 'items-center' : 'items-start'}`}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={`w-full rounded-xl bg-background shadow-xl outline-none ${DIALOG_WIDTH[size]}`}
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
            {footer ?? (
              <Button
                variant={confirmVariant}
                disabled={confirmButtonDisabled}
                onClick={() => (onConfirm ? onConfirm() : onClose())}
              >
                {confirmButtonLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
