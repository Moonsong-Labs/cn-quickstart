import type React from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button, type ButtonVariant } from './Button';
import { CloseButton } from './CloseButton';

type ModalProps = {
  show: boolean;
  title: React.ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  children?: React.ReactNode; // body content
  footer?: React.ReactNode; // optional footer; default renders a Close button
  size?: keyof typeof DIALOG_WIDTH;
  centered?: boolean; // center vertically
  backdrop?: 'static' | true | false; // 'static' disables outside click to close
  zIndexBase?: number; // base z-index for backdrop; modal = base+5
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
  backdrop = 'static',
  zIndexBase = 1500,
  confirmVariant = 'secondary',
  confirmButtonLabel = 'Close',
  confirmButtonDisabled = false,
}: ModalProps) {
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
      {backdrop === true ? (
        <button
          type="button"
          className="fixed inset-0 bg-black/50"
          style={{ zIndex: zIndexBase }}
          aria-label="Close dialog"
          onClick={onClose}
        />
      ) : (
        backdrop !== false && (
          <div
            className="fixed inset-0 bg-black/50"
            style={{ zIndex: zIndexBase }}
          />
        )
      )}
      <div
        className={`fixed inset-0 flex justify-center overflow-y-auto p-4 font-sans text-neutral-900 ${centered ? 'items-center' : 'items-start'}`}
        role="dialog"
        aria-modal="true"
        style={{ zIndex: zIndexBase + 5 }}
      >
        <div className={`w-full rounded-xl bg-white shadow-xl ${DIALOG_WIDTH[size]}`}>
          <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-4">
            <h5 className="text-lg font-semibold">{title}</h5>
            <CloseButton onClick={onClose} />
          </div>
          <div className="px-6 py-5">{children}</div>
          <div className="flex justify-end gap-2 border-t border-neutral-200 px-6 py-4">
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
