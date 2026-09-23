import type { Request } from 'express';

import type { RequestContext } from './services/token.service';

export function requestContextOf(request: Request): RequestContext {
  return {
    ipAddress: request.ip,
    userAgent: request.get('user-agent') ?? undefined,
  };
}
