import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { CsrfGuard } from './csrf.guard';

function contextFor(
  method: string,
  cookies: Record<string, string> = {},
  header?: string,
  path = '/api/staff/users',
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        path,
        cookies,
        headers: header ? { 'x-csrf-token': header } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

const staff = (token: string) => ({ tms_staff_csrf: token });
const driver = (token: string) => ({ tms_driver_csrf: token });

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();

  it('lets safe methods through without a token', () => {
    expect(guard.canActivate(contextFor('GET'))).toBe(true);
  });

  it('accepts a matching cookie and header', () => {
    expect(guard.canActivate(contextFor('POST', staff('abc123'), 'abc123'))).toBe(true);
  });

  it('reads the driver cookie on the driver API', () => {
    const path = '/api/driver/auth/logout';

    expect(guard.canActivate(contextFor('POST', driver('abc123'), 'abc123', path))).toBe(true);
    expect(() => guard.canActivate(contextFor('POST', staff('abc123'), 'abc123', path))).toThrow(
      ForbiddenException,
    );
  });

  it('ignores the driver cookie on the staff API', () => {
    expect(() => guard.canActivate(contextFor('POST', driver('abc123'), 'abc123'))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a mismatched header', () => {
    expect(() => guard.canActivate(contextFor('POST', staff('abc123'), 'nope'))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a request carrying the cookie but no header', () => {
    expect(() => guard.canActivate(contextFor('POST', staff('abc123')))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a request with neither', () => {
    expect(() => guard.canActivate(contextFor('DELETE'))).toThrow(ForbiddenException);
  });
});
