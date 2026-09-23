import { afterEach, describe, expect, it } from 'vitest';

import { readCsrfToken } from '@/shared/api/csrf';

function setCookie(value: string): void {
  Object.defineProperty(document, 'cookie', { value, writable: true, configurable: true });
}

describe('readCsrfToken', () => {
  afterEach(() => {
    setCookie('');
  });

  it('reads the token when it is the only cookie', () => {
    setCookie('tms_staff_csrf=abc123');

    expect(readCsrfToken('tms_staff_csrf')).toBe('abc123');
  });

  it('reads the token from among other cookies', () => {
    setCookie('other=1; tms_staff_csrf=abc123; another=2');

    expect(readCsrfToken('tms_staff_csrf')).toBe('abc123');
  });

  it('does not match a cookie whose name merely ends with the same text', () => {
    setCookie('not_tms_staff_csrf=wrong');

    expect(readCsrfToken('tms_staff_csrf')).toBeNull();
  });

  it("does not read the other audience's cookie", () => {
    setCookie('tms_driver_csrf=abc123');

    expect(readCsrfToken('tms_staff_csrf')).toBeNull();
  });

  it('returns null when absent', () => {
    setCookie('other=1');

    expect(readCsrfToken('tms_staff_csrf')).toBeNull();
  });
});
