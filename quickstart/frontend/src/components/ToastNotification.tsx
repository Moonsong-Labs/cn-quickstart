// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../stores/toastStore';
import { CloseButton } from './CloseButton';
import { staysInteractive } from './dialogLayer';

/** The notification at the top of the screen. It shows above open dialogs and stays usable there. */
const ToastNotification: React.FC = () => {
  const { message, show, hideError } = useToast();

  const isError = message.startsWith('Error:');
  const isSuccess = message.startsWith('Success:');

  const background = isError ? 'bg-danger-solid' : isSuccess ? 'bg-primary' : 'bg-info-solid';
  const heading = isError ? 'Error' : isSuccess ? 'Success' : 'Info';

  return createPortal(
    <div
      {...staysInteractive}
      className="pointer-events-none fixed inset-x-4 top-12 z-60 flex justify-center"
    >
      <div
        id="liveToast"
        role="alert"
        aria-atomic="true"
        className={`pointer-events-auto w-full max-w-88 overflow-hidden rounded-xl text-sm text-inverse shadow-lg ${background} ${show ? 'block' : 'hidden'}`}
      >
        <div className="flex items-center justify-between border-b border-inverse/20 px-4 py-2">
          <strong>{heading}</strong>
          <CloseButton
            tone="inverse"
            onClick={hideError}
          />
        </div>
        <div className="px-4 py-3 break-words">{message}</div>
      </div>
    </div>,
    document.body,
  );
};

export default ToastNotification;
