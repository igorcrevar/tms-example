import { createApiClient } from '@/shared/api/client';
import { createSessionHooks } from '@/shared/auth/session';
import type { DriverProfile } from '@/shared/auth/types';

const LOGIN_PATH = '/driver/login';

export const driverApi = createApiClient({
  baseURL: import.meta.env.VITE_DRIVER_API_BASE_URL || '/api/driver',
  csrfCookie: 'tms_driver_csrf',
  onSessionExpired: () => {
    if (!window.location.pathname.startsWith(LOGIN_PATH)) {
      window.location.assign(LOGIN_PATH);
    }
  },
});

export const { sessionKey, useSession, useLogout } = createSessionHooks<DriverProfile>(
  driverApi,
  'driver',
);
