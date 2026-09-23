import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { addMilliseconds, isAfter } from 'date-fns';
import { EntityManager, Repository } from 'typeorm';

import { AppConfig } from '../../../config/app-config';
import { User } from '../../user/entities/user.entity';

/**
 * Per-account throttling. Sits alongside the per-IP ThrottlerGuard: one stops
 * a single account being ground down from many addresses, the other stops one
 * address spraying many accounts.
 */
@Injectable()
export class LockoutService {
  private readonly maxAttempts: number;
  private readonly lockoutMs: number;
  private readonly logger = new Logger(LockoutService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    config: AppConfig,
  ) {
    this.maxAttempts = config.auth.maxFailedAttempts;
    this.lockoutMs = config.auth.lockoutMs;
  }

  isLocked(user: User, now: Date = new Date()): boolean {
    return user.lockedUntil !== null && isAfter(user.lockedUntil, now);
  }

  async registerFailure(user: User, mng?: EntityManager): Promise<void> {
    const failedLoginAttempts = user.failedLoginAttempts + 1;
    const shouldLock = failedLoginAttempts >= this.maxAttempts;
    const lockedUntil = shouldLock ? addMilliseconds(new Date(), this.lockoutMs) : null;

    if (shouldLock) {
      this.logger.warn(`User ${user.id} locked after ${failedLoginAttempts} failed attempts`);
    }

    const repo = !mng ? this.users : mng.getRepository(User);
    await repo.update(user.id, {
      failedLoginAttempts,
      lockedUntil,
    });
  }
}
