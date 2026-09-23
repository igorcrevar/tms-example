import * as Sentry from '@sentry/react';
import axios from 'axios';
import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

import { readCsrfToken } from './csrf';

const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['get', 'head', 'options']);

type RetriableConfig = InternalAxiosRequestConfig & { retried?: boolean };

export interface ApiClientOptions {
  /** '/api/staff' or '/api/driver' — the two audiences never share a client. */
  baseURL: string;
  /** Each audience has its own readable CSRF cookie, so one logout cannot clear the other's. */
  csrfCookie: string;
  onSessionExpired: () => void;
}

export function createApiClient({
  baseURL,
  csrfCookie,
  onSessionExpired,
}: ApiClientOptions): AxiosInstance {
  const client = axios.create({
    baseURL,
    // Tokens live in HttpOnly cookies, so every call must carry credentials.
    withCredentials: true,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use((config) => {
    if (!SAFE_METHODS.has((config.method ?? 'get').toLowerCase())) {
      const token = readCsrfToken(csrfCookie);

      if (token) {
        config.headers.set(CSRF_HEADER, token);
      }
    }

    return config;
  });

  let refreshing: Promise<unknown> | null = null;

  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetriableConfig | undefined;
      const status = error.response?.status;
      const isAuthCall = config?.url?.startsWith('/auth/') ?? false;

      if (status === 401 && config && !config.retried && !isAuthCall) {
        config.retried = true;

        // One shared refresh, so parallel 401s do not rotate the token twice.
        refreshing ??= client.post('/auth/refresh').finally(() => {
          refreshing = null;
        });

        try {
          await refreshing;
          return await client.request(config);
        } catch {
          onSessionExpired();
        }
      }

      // 4xx is expected traffic; only report what the server could not handle.
      if (status === undefined || status >= 500) {
        Sentry.captureException(error);
      }

      return Promise.reject(error);
    },
  );

  return client;
}
