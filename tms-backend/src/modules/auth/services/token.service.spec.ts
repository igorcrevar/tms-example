import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EntityManager, FindOperator, FindOptionsWhere, Repository } from 'typeorm';

import { configFor } from '../../../config/app-config.fixture';
import { RefreshToken, TokenAudience } from '../entities/refresh-token.entity';
import { TokenService } from './token.service';

const config = configFor();

/** Minimal in-memory stand-in for the refresh_tokens table. */
function buildRepository() {
  const rows = new Map<string, RefreshToken>();

  return {
    rows,
    create: (data: Partial<RefreshToken>) => ({ ...data }) as RefreshToken,
    save: (row: RefreshToken) => {
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
    findOne: ({ where }: { where: { tokenHash: string } }) =>
      Promise.resolve([...rows.values()].find((row) => row.tokenHash === where.tokenHash) ?? null),
    update: (criteria: string | FindOptionsWhere<RefreshToken>, patch: Partial<RefreshToken>) => {
      const where: FindOptionsWhere<RefreshToken> =
        typeof criteria === 'string' ? { id: criteria } : criteria;

      // The service only ever uses IsNull(), so any operator here means "column is null".
      const targets = [...rows.values()].filter((row) =>
        Object.entries(where).every(([column, expected]) => {
          const actual = row[column as keyof RefreshToken];

          return expected instanceof FindOperator ? actual == null : actual === expected;
        }),
      );

      for (const row of targets) {
        Object.assign(row, patch);
      }

      return Promise.resolve({ affected: targets.length });
    },
  };
}

type FakeRepository = ReturnType<typeof buildRepository>;

/** Stands in for a transaction manager handing out that same in-memory table. */
function managerFor(repository: FakeRepository): EntityManager {
  return { getRepository: () => repository } as unknown as EntityManager;
}

describe('TokenService', () => {
  let repository: FakeRepository;
  let manager: EntityManager;
  let service: TokenService;

  beforeEach(() => {
    repository = buildRepository();
    manager = managerFor(repository);
    service = new TokenService(
      new JwtService({}),
      config,
      repository as unknown as Repository<RefreshToken>,
    );
  });

  it('writes through the manager it is given, never its own repository', async () => {
    // An injected repository takes its own connection and escapes the caller's transaction.
    const joined = buildRepository();

    await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff },
      managerFor(joined),
    );

    expect(joined.rows.size).toBe(1);
    expect(repository.rows.size).toBe(0);
  });

  it('stores only a hash of the refresh token, never the token itself', async () => {
    const session = await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff },
      manager,
    );

    const [row] = [...repository.rows.values()];

    expect(row.tokenHash).toHaveLength(64);
    expect(row.tokenHash).not.toContain(session.refreshToken);
    expect(JSON.stringify(row)).not.toContain(session.refreshToken);
  });

  it('rotates into the same family and revokes the consumed token', async () => {
    const first = await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff },
      manager,
    );
    const consumed = await service.consumeRefreshToken(
      first.refreshToken,
      TokenAudience.Staff,
      manager,
    );

    expect(consumed.familyId).toBe(first.familyId);
    expect(repository.rows.get(first.refreshTokenId)?.revokedAt).toBeInstanceOf(Date);

    const second = await service.issueSession(
      {
        userId: 'user-1',
        audience: TokenAudience.Staff,
        familyId: consumed.familyId,
        replacesTokenId: consumed.tokenId,
      },
      manager,
    );

    expect(second.familyId).toBe(first.familyId);
    expect(repository.rows.get(first.refreshTokenId)?.replacedByTokenId).toBe(
      second.refreshTokenId,
    );
  });

  it('revokes the whole family when a consumed token is replayed', async () => {
    const first = await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff },
      manager,
    );
    const consumed = await service.consumeRefreshToken(
      first.refreshToken,
      TokenAudience.Staff,
      manager,
    );
    const second = await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff, familyId: consumed.familyId },
      manager,
    );

    await expect(
      service.consumeRefreshToken(first.refreshToken, TokenAudience.Staff, manager),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // The still-live descendant must die with the replayed ancestor.
    expect(repository.rows.get(second.refreshTokenId)?.revokedAt).toBeInstanceOf(Date);
  });

  it('treats a token consumed between the read and the claim as a replay', async () => {
    const first = await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff },
      manager,
    );
    const second = await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff, familyId: first.familyId },
      manager,
    );
    const stored = repository.rows.get(first.refreshTokenId)!;

    // A rival consumer commits after this read and before the conditional claim; without
    // the condition both rotations would succeed and the theft would go undetected.
    const racing = {
      ...repository,
      findOne: () => {
        stored.revokedAt = new Date();
        return Promise.resolve({ ...stored, revokedAt: null } as RefreshToken);
      },
    };

    await expect(
      service.consumeRefreshToken(first.refreshToken, TokenAudience.Staff, {
        getRepository: () => racing,
      } as unknown as EntityManager),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(repository.rows.get(second.refreshTokenId)?.revokedAt).toBeInstanceOf(Date);
  });

  it('revokes a replayed family off the caller transaction, which is about to roll back', async () => {
    const first = await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff },
      manager,
    );
    await service.consumeRefreshToken(first.refreshToken, TokenAudience.Staff, manager);
    const revokeFamily = jest.spyOn(service, 'revokeFamily');

    await expect(
      service.consumeRefreshToken(first.refreshToken, TokenAudience.Staff, manager),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    // No manager: the throw rolls the caller's transaction back and this must outlive it.
    expect(revokeFamily).toHaveBeenCalledWith(first.familyId);
  });

  it('refuses a driver refresh token on the staff audience', async () => {
    const driverSession = await service.issueSession(
      { userId: 'driver-1', audience: TokenAudience.Driver },
      manager,
    );

    await expect(
      service.consumeRefreshToken(driverSession.refreshToken, TokenAudience.Staff, manager),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an access token presented as a refresh token', async () => {
    const session = await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff },
      manager,
    );

    await expect(
      service.consumeRefreshToken(session.accessToken, TokenAudience.Staff, manager),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('round-trips an MFA challenge and rejects other token types', async () => {
    const challenge = await service.createMfaChallenge('user-1', true);

    await expect(service.verifyMfaChallenge(challenge)).resolves.toEqual({
      userId: 'user-1',
      enrolmentRequired: true,
    });

    const session = await service.issueSession(
      { userId: 'user-1', audience: TokenAudience.Staff },
      manager,
    );

    await expect(service.verifyMfaChallenge(session.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('gives an enrolment challenge the longer TTL', async () => {
    const jwt = new JwtService({});
    const lifetimeOf = async (enrolmentRequired: boolean) => {
      const token = await service.createMfaChallenge('user-1', enrolmentRequired);
      const { iat, exp } = jwt.decode<{ iat: number; exp: number }>(token);

      return exp - iat;
    };

    expect(await lifetimeOf(false)).toBe(config.auth.mfaChallengeTtl);
    expect(await lifetimeOf(true)).toBe(config.auth.mfaEnrolmentTtl);
    expect(config.auth.mfaEnrolmentTtl).toBeGreaterThan(config.auth.mfaChallengeTtl);
  });
});
