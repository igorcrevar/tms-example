import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TokenAudience } from '../auth/entities/refresh-token.entity';
import { PasswordService } from '../auth/services/password.service';
import { TokenService } from '../auth/services/token.service';
import { Role } from '../user/entities/role.entity';
import { User, UserStatus } from '../user/entities/user.entity';
import { UserSummary, toUserSummary } from '../user/user.mapper';
import { CreateDriverDto } from './dto';
import { Driver } from './entities/driver.entity';

@Injectable()
export class DriverService {
  private readonly logger = new Logger(DriverService.name);

  constructor(
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Drivers are created outright rather than invited: they have no email login
   * and no password, so there is nothing for them to accept.
   */
  async create(dto: CreateDriverDto, actorId: string): Promise<UserSummary> {
    const email = dto.email.trim().toLowerCase();
    const driverCode = dto.driverCode.trim().toUpperCase();

    if (await this.users.findOne({ where: { email } })) {
      throw new ConflictException('A user with that email already exists');
    }

    if (await this.drivers.findOne({ where: { driverCode } })) {
      throw new ConflictException('A driver with that code already exists');
    }

    this.logger.log(`Creating driver ${driverCode} (${dto.driverType}) on behalf of ${actorId}`);

    const role = await this.pinLoginRole();
    const pinHash = await this.passwords.hash(dto.pin);

    const { user, driver } = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(
        manager.create(User, {
          email,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          passwordHash: null,
          status: UserStatus.Active,
          roleId: role.id,
        }),
      );

      const createdDriver = await manager.save(
        manager.create(Driver, {
          driverCode,
          userId: created.id,
          driverType: dto.driverType,
          pinHash,
          pinUpdatedAt: new Date(),
          licenseNumber: dto.licenseNumber ?? null,
        }),
      );

      return { user: created, driver: createdDriver };
    });

    this.logger.log(`Created driver ${driver.id} with user ${user.id}`);

    user.role = role;

    return toUserSummary(user, driver);
  }

  /** The request names no role, so the one PIN role must be unambiguous. */
  private async pinLoginRole(): Promise<Role> {
    const roles = await this.roles.find({ where: { pinLogin: true } });

    if (roles.length !== 1) {
      throw new Error(`Expected exactly one role with pinLogin, found ${roles.length}`);
    }

    return roles[0];
  }

  /** Changing the PIN invalidates existing driver sessions. */
  async setPin(driverId: string, pin: string, actorId: string): Promise<void> {
    const driver = await this.drivers.findOne({ where: { id: driverId } });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    this.logger.log(`Updating the PIN for driver ${driver.id} on behalf of ${actorId}`);

    const pinHash = await this.passwords.hash(pin);

    this.logger.log(`Revoking driver sessions for ${driver.userId} after the PIN change`);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Driver, driver.id, { pinHash, pinUpdatedAt: new Date() });
      await manager.update(User, driver.userId, { failedLoginAttempts: 0, lockedUntil: null });

      await this.tokens.revokeAllForUser(driver.userId, TokenAudience.Driver, manager);
    });
  }
}
