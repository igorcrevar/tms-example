import { format } from 'winston';

const SECRET_KEY = /pass(word)?|pin|secret|token|authorization|cookie|otp|credential/i;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

/**
 * Masks credential-shaped keys anywhere in the logged payload. Enforcing this
 * at the transport means a careless log call cannot leak a secret to disk.
 */
export const redactSecrets = format((info) => redactValue(info, 0) as typeof info);

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, depth + 1));
  }

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(source)) {
    result[key] = SECRET_KEY.test(key) ? REDACTED : redactValue(entry, depth + 1);
  }

  return result;
}
