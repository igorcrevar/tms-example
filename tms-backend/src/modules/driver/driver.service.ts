import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { TokenAudience } from '../auth/entities/refresh-token.entity';
import { PasswordService } from '../auth/services/password.service';
import { TokenService } from '../auth/services/token.service';
import { Role } from '../user/entities/role.entity';
import { User, UserStatus } from '../user/entities/user.entity';
import { UserSummary, toUserSummary } from '../user/user.mapper';
import { CreateDriverDto } from './dto';
import { Driver } from './entities/driver.entity';
import { PinResetRequest } from './entities/pin-reset-request.entity';

export interface PinResetRequestSummary {
  id: string;
  driverId: string;
  driverCode: string;
  firstName: string;
  lastName: string;
  requestedAt: string;
}

@Injectable()
export class DriverService {
  private readonly logger = new Logger(DriverService.name);

  constructor(
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(PinResetRequest) private readonly pinResets: Repository<PinResetRequest>,
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

      const resolved = await manager.update(
        PinResetRequest,
        { driverId: driver.id, resolvedAt: IsNull() },
        { resolvedAt: new Date(), resolvedById: actorId },
      );

      this.logger.log(
        `Resolved ${resolved.affected ?? 0} PIN reset request(s) for driver ${driver.id}`,
      );
    });
  }

  /**
   * Every outcome is silent towards the caller, so an unknown code cannot be told
   * apart from a known one; the reason is logged without the code itself.
   */
  async requestPinReset(driverCode: string): Promise<void> {
    const driver = await this.drivers.findOne({
      where: { driverCode: driverCode.trim() },
      relations: { user: true },
    });

    if (!driver || driver.user.status !== UserStatus.Active) {
      this.logger.warn('Ignoring PIN reset request: no active driver matches that code');
      return;
    }

    if (await this.pinResets.existsBy({ driverId: driver.id, resolvedAt: IsNull() })) {
      this.logger.log(`Ignoring PIN reset request for driver ${driver.id}: one is already open`);
      return;
    }

    this.logger.log(`Recording a PIN reset request for driver ${driver.id}`);

    await this.pinResets.insert({ driverId: driver.id });
  }

  async listOpenPinResetRequests(): Promise<PinResetRequestSummary[]> {
    const requests = await this.pinResets
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.driver', 'driver')
      .innerJoinAndSelect('driver.user', 'user')
      .where('request.resolvedAt IS NULL')
      .orderBy('request.createdAt', 'ASC')
      .getMany();

    return requests.map((request) => ({
      id: request.id,
      driverId: request.driverId,
      driverCode: request.driver.driverCode,
      firstName: request.driver.user.firstName,
      lastName: request.driver.user.lastName,
      requestedAt: request.createdAt.toISOString(),
    }));
  }
}
