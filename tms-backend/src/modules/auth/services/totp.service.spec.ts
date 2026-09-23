import { authenticator } from 'otplib';

import { configFor } from '../../../config/app-config.fixture';
import { TotpService } from './totp.service';

describe('TotpService', () => {
  const service = new TotpService(configFor({ TOTP_ISSUER: 'TMS', TOTP_WINDOW: '1' }));

  it('accepts the code a matching authenticator would produce', () => {
    const secret = service.generateSecret();

    expect(service.verify(secret, authenticator.generate(secret))).toBe(true);
  });

  it('rejects a code generated from a different secret', () => {
    const secret = service.generateSecret();
    const other = authenticator.generate(service.generateSecret());

    expect(service.verify(secret, other)).toBe(false);
  });

  it('returns false instead of throwing on malformed input', () => {
    expect(service.verify(service.generateSecret(), 'nope')).toBe(false);
  });

  it('builds an otpauth URI carrying the issuer', () => {
    const uri = service.buildUri('admin@tms.local', service.generateSecret());

    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=TMS');
  });
});
