export enum AuthCookie {
  StaffAccess = 'tms_staff_at',
  StaffRefresh = 'tms_staff_rt',
  StaffMfa = 'tms_staff_mfa',
  DriverAccess = 'tms_driver_at',
  DriverRefresh = 'tms_driver_rt',
  /** Readable by JS on purpose — the double-submit half of the CSRF check. */
  StaffCsrf = 'tms_staff_csrf',
  DriverCsrf = 'tms_driver_csrf',
}

/**
 * Refresh cookies are scoped to the auth routes so they are not attached to
 * every ordinary API call.
 */
export enum CookiePath {
  StaffApi = '/api/staff',
  StaffAuth = '/api/staff/auth',
  DriverApi = '/api/driver',
  DriverAuth = '/api/driver/auth',
  Root = '/',
}

export const CSRF_HEADER = 'x-csrf-token';

export enum TokenType {
  Access = 'access',
  Refresh = 'refresh',
  MfaChallenge = 'mfa',
}

/** One rule for every password the API accepts; the frontend mirrors it. */
export const MIN_PASSWORD_LENGTH = 8;
