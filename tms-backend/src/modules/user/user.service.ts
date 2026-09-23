import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { Driver } from '../driver/entities/driver.entity';
import { TokenAudience } from '../auth/entities/refresh-token.entity';
import { TokenService } from '../auth/services/token.service';
import { ListUsersQueryDto } from './dto';
import { User, UserStatus } from './entities/user.entity';
import { UserSummary, toUserSummary } from './user.mapper';

export interface PagedUsers {
  items: UserSummary[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    private readonly tokens: TokenService,
    private readonly dataSource: DataSource,
  ) {}

  /** Excludes the caller: the list is of *other* users. Soft-deleted rows never appear. */
  async list(query: ListUsersQueryDto, callerId: string): Promise<PagedUsers> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const builder = this.users
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .where('user.id != :callerId', { callerId });

    if (query.role) {
      builder.andWhere('role.name = :role', { role: query.role });
    }

    if (query.status) {
      builder.andWhere('user.status = :status', { status: query.status });
    }

    if (query.search) {
      // Escape the ILIKE wildcards so a typed % or _ matches itself.
      const search = query.search.replace(/[\\%_]/g, (char) => `\\${char}`);

      builder.andWhere(
        '(user.email ILIKE :search OR user.firstName ILIKE :search OR user.lastName ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    this.logger.log(`Listing users for ${callerId} (role=${query.role ?? 'all'}, page=${page})`);

    const [users, total] = await builder
      .orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const driversByUserId = await this.driversFor(users);

    return {
      items: users.map((user) => toUserSummary(user, driversByUserId.get(user.id) ?? null)),
      total,
      page,
      limit,
    };
  }

  /** One extra query for the page, rather than a join that fans out per row. */
  private async driversFor(users: User[]): Promise<Map<string, Driver>> {
    const driverUserIds = users.filter((user) => user.role?.pinLogin).map((user) => user.id);

    if (driverUserIds.length === 0) {
      return new Map();
    }

    const drivers = await this.drivers.find({ where: { userId: In(driverUserIds) } });

    return new Map(drivers.map((driver) => [driver.userId, driver]));
  }

  async softDelete(userId: string, callerId: string): Promise<void> {
    if (userId === callerId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role?.isSuperAdmin) {
      throw new ForbiddenException('This account cannot be deleted');
    }

    this.logger.log(`Soft-deleting user ${userId} on behalf of ${callerId}`);

    await this.dataSource.transaction(async (manager) => {
      await manager.softDelete(Driver, { userId });
      await manager.softDelete(User, { id: userId });
      // A deleted account must not keep working until its access token expires.
      await this.tokens.revokeAllForUser(userId, TokenAudience.Staff, manager);
      await this.tokens.revokeAllForUser(userId, TokenAudience.Driver, manager);
    });
  }

  /** For someone who has lost their authenticator: they enrol again at next sign-in. */
  async resetTwoFactor(userId: string, callerId: string): Promise<void> {
    if (userId === callerId) {
      throw new BadRequestException('You cannot reset your own second factor');
    }

    const user = await this.users.findOne({ where: { id: userId }, relations: { role: true } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role?.pinLogin) {
      throw new BadRequestException('Drivers sign in with a PIN and have no second factor');
    }

    if (user.status === UserStatus.Invited) {
      throw new BadRequestException('This user has not accepted their invitation yet');
    }

    this.logger.log(`Clearing the second factor for user ${userId} on behalf of ${callerId}`);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(User, userId, { totpSecret: null, totpEnabledAt: null });
      // Existing sessions were built on the old factor, so they go with it.
      await this.tokens.revokeAllForUser(userId, TokenAudience.Staff, manager);
    });
  }

  findLiveById(userId: string): Promise<User | null> {
    return this.users.findOne({ where: { id: userId } });
  }
}
