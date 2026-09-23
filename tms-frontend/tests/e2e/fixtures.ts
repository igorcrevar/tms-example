import { createHmac } from 'node:crypto';

/** Mirrors tms-backend/src/database/seeds/e2e-fixtures.ts. Test data, not secrets. */
export const STAFF_EMAIL = 'e2e-ui-admin@tms.local';
export const STAFF_PASSWORD = 'e2e-ui-password-long-enough';
export const TOTP_SECRET = 'KRSXG5CTMVRXEZLUKQ2TEMY';
export const DRIVER_CODE = 'E2E-UI-1';
export const DRIVER_PIN = '482913';
export const SUPER_ADMIN_EMAIL = 'e2e-ui-superadmin@tms.local';
export const SUPER_ADMIN_PASSWORD = 'e2e-ui-superadmin-password-long-enough';
export const SUPER_ADMIN_TOTP_SECRET = 'KN2XAZLSIFSG22LOKVEVGZLDOJSXIM';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  let bits = '';

  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);

    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }

    bits += index.toString(2).padStart(5, '0');
  }

  const bytes = bits.match(/.{8}/g) ?? [];

  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/**
 * RFC 6238 TOTP. Written here rather than pulled in as a dependency, since the
 * browser suite only needs to produce the code the seeded secret expects.
 */
export function generateTotp(secret: string = TOTP_SECRET, now: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(Math.floor(now / 1000 / 30)));

  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 1_000_000).toString().padStart(6, '0');
}
