import type { Request } from 'express';

/** Tokens live in HttpOnly cookies, never in the Authorization header. */
export function fromAuthCookie(name: string): (req: Request) => string | null {
  return (req) => (req.cookies as Record<string, string> | undefined)?.[name] ?? null;
}
