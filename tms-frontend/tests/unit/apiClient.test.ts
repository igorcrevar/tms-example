import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@/shared/api/client';

function setCookie(value: string): void {
  Object.defineProperty(document, 'cookie', { value, writable: true, configurable: true });
}

function respond(config: InternalAxiosRequestConfig, status: number): AxiosResponse {
  return { data: {}, status, statusText: '', headers: {}, config };
}

describe('createApiClient', () => {
  beforeEach(() => {
    setCookie('tms_staff_csrf=token-from-cookie');
  });

  it('sends credentials so HttpOnly cookies travel with every call', () => {
    const client = createApiClient({
      baseURL: '/api/staff',
      csrfCookie: 'tms_staff_csrf',
      onSessionExpired: vi.fn(),
    });

    expect(client.defaults.withCredentials).toBe(true);
  });

  it('attaches the CSRF header to mutating requests only', async () => {
    const seen: InternalAxiosRequestConfig[] = [];
    const client = createApiClient({
      baseURL: '/api/staff',
      csrfCookie: 'tms_staff_csrf',
      onSessionExpired: vi.fn(),
    });

    client.defaults.adapter = (config) => {
      seen.push(config);
      return Promise.resolve(respond(config, 200));
    };

    await client.get('/things');
    await client.post('/things', {});

    expect(seen[0].headers.get('x-csrf-token')).toBeUndefined();
    expect(seen[1].headers.get('x-csrf-token')).toBe('token-from-cookie');
  });

  it('refreshes once on 401 and replays the original request', async () => {
    const urls: string[] = [];
    const client = createApiClient({
      baseURL: '/api/staff',
      csrfCookie: 'tms_staff_csrf',
      onSessionExpired: vi.fn(),
    });

    client.defaults.adapter = (config) => {
      urls.push(config.url ?? '');

      if (config.url === '/things' && urls.filter((url) => url === '/things').length === 1) {
        return Promise.reject(
          Object.assign(new Error('Unauthorized'), {
            isAxiosError: true,
            config,
            response: respond(config, 401),
          }),
        );
      }

      return Promise.resolve(respond(config, 200));
    };

    await client.get('/things');

    expect(urls).toEqual(['/things', '/auth/refresh', '/things']);
  });

  it('does not try to refresh a failed auth call', async () => {
    const urls: string[] = [];
    const onSessionExpired = vi.fn();
    const client = createApiClient({
      baseURL: '/api/staff',
      csrfCookie: 'tms_staff_csrf',
      onSessionExpired,
    });

    client.defaults.adapter = (config) => {
      urls.push(config.url ?? '');

      return Promise.reject(
        Object.assign(new Error('Unauthorized'), {
          isAxiosError: true,
          config,
          response: respond(config, 401),
        }),
      );
    };

    await expect(client.post('/auth/login', {})).rejects.toThrow();
    expect(urls).toEqual(['/auth/login']);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});
