import { createApiClient } from '@/shared/api/client';
import { createSessionHooks } from '@/shared/auth/session';
import type { StaffProfile } from '@/shared/auth/types';

const LOGIN_PATH = '/admin/login';

export const adminApi = createApiClient({
  baseURL: import.meta.env.VITE_STAFF_API_BASE_URL || '/api/staff',
  csrfCookie: 'tms_staff_csrf',
  onSessionExpired: () => {
    if (!window.location.pathname.startsWith(LOGIN_PATH)) {
      window.location.assign(LOGIN_PATH);
    }
  },
});

export const { sessionKey, useSession, useLogout } = createSessionHooks<StaffProfile>(
  adminApi,
  'admin',
);
