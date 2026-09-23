import { EntityManager, Repository } from 'typeorm';

import { configFor } from '../../../config/app-config.fixture';
import { User } from '../../user/entities/user.entity';
import { LockoutService } from './lockout.service';

function userWith(failedLoginAttempts: number, lockedUntil: Date | null = null): User {
  return { id: 'user-1', failedLoginAttempts, lockedUntil } as User;
}

describe('LockoutService', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  let users: { update: jest.Mock };
  let service: LockoutService;

  beforeEach(() => {
    users = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    service = new LockoutService(
      users as unknown as Repository<User>,
      configFor({ AUTH_MAX_FAILED_ATTEMPTS: '3', AUTH_LOCKOUT_MS: '900000' }),
    );
  });

  it('counts a failure without locking below the threshold', async () => {
    await service.registerFailure(userWith(1));

    expect(users.update).toHaveBeenCalledWith('user-1', {
      failedLoginAttempts: 2,
      lockedUntil: null,
    });
  });

  it('locks for the configured window once the threshold is reached', async () => {
    const before = Date.now();

    await service.registerFailure(userWith(2));

    const [, patch] = users.update.mock.calls[0] as [
      string,
      { failedLoginAttempts: number; lockedUntil: Date },
    ];
    expect(patch.failedLoginAttempts).toBe(3);
    expect(patch.lockedUntil.getTime()).toBeGreaterThanOrEqual(before + 900_000);
  });

  it("writes through the caller's manager when given one", async () => {
    const repo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const mng = { getRepository: jest.fn().mockReturnValue(repo) } as unknown as EntityManager;

    await service.registerFailure(userWith(0), mng);

    expect(repo.update).toHaveBeenCalledWith('user-1', {
      failedLoginAttempts: 1,
      lockedUntil: null,
    });
    expect(users.update).not.toHaveBeenCalled();
  });

  it('treats a future lock as locked and a past or absent one as open', () => {
    expect(service.isLocked(userWith(3, new Date('2026-01-01T12:10:00.000Z')), now)).toBe(true);
    expect(service.isLocked(userWith(3, new Date('2026-01-01T11:50:00.000Z')), now)).toBe(false);
    expect(service.isLocked(userWith(0), now)).toBe(false);
  });
});
