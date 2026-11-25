// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useToast } from '../stores/toastStore';

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
          <button
            type="button"
            className="cursor-pointer rounded-md p-1 text-white/80 hover:bg-white/10 hover:text-white"
            onClick={hideError}
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M3 3l10 10M13 3 3 13" />
            </svg>
          </button>
        </div>
        <div className="px-4 py-3 break-words">{message}</div>
      </div>
    </div>
  );
};

export default ToastNotification;
