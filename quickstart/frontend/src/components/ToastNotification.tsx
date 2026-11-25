// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useToast } from '../stores/toastStore';
import { CloseButton } from './CloseButton';

const ToastNotification: React.FC = () => {
  const { message, show, hideError } = useToast();

  const isError = message.startsWith('Error:');
  const isSuccess = message.startsWith('Success:');

  const bgClass = isError ? 'bg-danger-solid' : isSuccess ? 'bg-primary' : 'bg-info-solid';
  const headerText = isError ? 'Error' : isSuccess ? 'Success' : 'Info';

  return (
    <div className="pointer-events-none fixed inset-x-4 top-12 z-60 flex justify-center">
      <div
        id="liveToast"
        className={`pointer-events-auto w-full max-w-88 overflow-hidden rounded-xl text-sm text-inverse shadow-lg ${bgClass} ${show ? 'block' : 'hidden'}`}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        <div className="flex items-center justify-between border-b border-inverse/20 px-4 py-2">
          <strong>{headerText}</strong>
          <CloseButton
            tone="inverse"
            onClick={hideError}
          />
        </div>
        <div className="px-4 py-3 break-words">{message}</div>
      </div>
    </div>
  );
};

export default ToastNotification;
