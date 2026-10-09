// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import { type AxiosError, isAxiosError } from 'axios';
import { useCallback } from 'react';
import type { ErrorResponse } from '../openapi.d.ts';
import { useToast } from '../stores/toastStore';

function isAxiosErrorWithErrorResponse(err: unknown): err is AxiosError<ErrorResponse> {
  return isAxiosError<ErrorResponse>(err);
}

function extractError(err: unknown): { status?: number; message?: string } {
  if (isAxiosErrorWithErrorResponse(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    return {
      status,
      message: data?.message ?? `HTTP ${status ?? 'Unknown error'}`,
    };
  }
  if (typeof err === 'object' && err !== null) {
    const record = err as { status?: unknown; message?: unknown };
    return {
      status: typeof record.status === 'number' ? record.status : undefined,
      message: typeof record.message === 'string' ? record.message : 'Unexpected error',
    };
  }
  return { message: 'Unexpected error' };
}

export function useWithErrorHandling(action: string) {
  const { displayError } = useToast();

  return useCallback(
    <T extends (...args: never[]) => Promise<unknown>>(
      fn: T,
      onSuccess?: (result: Awaited<ReturnType<T>>) => void,
    ) => {
      return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>> | undefined> => {
        try {
          const result = (await fn(...args)) as Awaited<ReturnType<T>>;
          onSuccess?.(result);
          return result;
        } catch (err) {
          const { status, message } = extractError(err);
          if (status === 400) {
            displayError(message ? `${action} reason: ${message}` : `Invalid input in ${action}`);
            return;
          }
          if (status === 401) {
            displayError(message ? `${action} reason: ${message}` : `Unauthorized for ${action}`);
            return;
          }
          if (status === 403) {
            displayError(message ? `${action} reason: ${message}` : `Forbidden for ${action}`);
            return;
          }
          if (status === 404) {
            displayError(message ? `${action} reason: ${message}` : `Not Found for ${action}`);
            return;
          }
          if (status === 409) {
            displayError(message ? `${action} reason: ${message}` : `Conflict in ${action}`);
            return;
          }
          displayError(message ? `${action} reason: ${message}` : `Unexpected error for ${action}`);
          return undefined;
        }
      };
    },
    [action, displayError],
  );
}
