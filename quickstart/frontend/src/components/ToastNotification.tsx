// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useToast } from '../stores/toastStore';
import { CloseButton } from './CloseButton';

const ToastNotification: React.FC = () => {
  const { message, show, hideError } = useToast();

  const isError = message.startsWith('Error:');
  const isSuccess = message.startsWith('Success:');

  const bgClass = isError ? 'bg-red-600' : isSuccess ? 'bg-brand-700' : 'bg-sky-600';
  const headerText = isError ? 'Error' : isSuccess ? 'Success' : 'Info';

  return (
    <div
      className="fixed top-12 left-1/2 -translate-x-1/2 font-sans"
      style={{ zIndex: 2000 }}
    >
      <div
        id="liveToast"
        className={`w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl text-sm text-white shadow-lg ${bgClass} ${show ? 'block' : 'hidden'}`}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        <div className="flex items-center justify-between border-b border-white/20 px-4 py-2">
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
