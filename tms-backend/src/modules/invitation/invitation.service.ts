import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { addSeconds, isPast } from 'date-fns';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';

import { AppConfig } from '../../config/app-config';
import { AbilityFactory } from '../auth/permissions/ability.factory';
import { PasswordService } from '../auth/services/password.service';
import { MailService } from '../mail/mail.service';
import { invitationEmail } from '../mail/templates';
import { InviteUserDto } from '../user/dto';
import { Role } from '../user/entities/role.entity';
import { User, UserStatus } from '../user/entities/user.entity';
import { UserSummary, toUserSummary } from '../user/user.mapper';
import { Invitation } from './entities/invitation.entity';

export interface InvitationPreview {
  email: string;
  firstName: string;
  expiresAt: string;
}

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    private readonly dataSource: DataSource,
    private readonly abilities: AbilityFactory,
  ) {}

  async invite(dto: InviteUserDto, invitedById: string): Promise<UserSummary> {
    const email = dto.email.trim().toLowerCase();

    if (await this.users.findOne({ where: { email } })) {
      throw new ConflictException('A user with that email already exists');
    }

    const role = await this.roles.findOne({ where: { name: dto.role } });

    if (!role) {
      throw new BadRequestException('Unknown role');
    }

    // An invitation sets a password, which a PIN role never uses.
    if (role.pinLogin) {
      throw new BadRequestException('Roles that sign in with a PIN are created, not invited');
    }

    await this.assertCanGrant(role, invitedById);

    this.logger.log(`Creating an invited ${dto.role} on behalf of ${invitedById}`);

    const { user, token, expiresAt } = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(
        manager.create(User, {
          email,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          passwordHash: null,
          status: UserStatus.Invited,
          roleId: role.id,
        }),
      );

      return { user: created, ...(await this.issue(manager, created.id, role.id, invitedById)) };
    });

    const acceptUrl = this.buildAcceptUrl(token);
    const message = invitationEmail({ firstName: user.firstName, acceptUrl, expiresAt });

    this.logger.log(`Invitation issued for user ${user.id} by ${invitedById}`);

    await this.mail.send({ to: email, ...message });

    user.role = role;

    return toUserSummary(user);
  }

  /** A fresh link for an invitee whose earlier one expired or never arrived. */
  async resend(userId: string, actorId: string): Promise<void> {
    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status !== UserStatus.Invited) {
      throw new BadRequestException('This user has already accepted their invitation');
    }

    await this.assertCanGrant(user.role, actorId);

    this.logger.log(`Reissuing the invitation for user ${userId} on behalf of ${actorId}`);

    const { token, expiresAt } = await this.dataSource.transaction(async (manager) => {
      // Only the newest link may activate the account; older ones in an inbox go dead.
      await manager.update(
        Invitation,
        { userId, acceptedAt: IsNull(), revokedAt: IsNull() },
        { revokedAt: new Date() },
      );

      return this.issue(manager, userId, user.roleId, actorId);
    });

    const acceptUrl = this.buildAcceptUrl(token);
    const message = invitationEmail({ firstName: user.firstName, acceptUrl, expiresAt });

    this.logger.log(`Invitation reissued for user ${userId} by ${actorId}`);

    await this.mail.send({ to: user.email, ...message });
  }

  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.findUsable(token);

    return {
      email: invitation.user.email,
      firstName: invitation.user.firstName,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async accept(token: string, password: string): Promise<void> {
    const invitation = await this.findUsable(token);
    const passwordHash = await this.passwords.hash(password);

    await this.dataSource.transaction(async (manager) => {
      // Single-use: the same token cannot activate a second account.
      const claimed = await manager.update(
        Invitation,
        { id: invitation.id, acceptedAt: IsNull(), revokedAt: IsNull() },
        { acceptedAt: new Date() },
      );

      if (claimed.affected !== 1) {
        throw new BadRequestException('This invitation has already been used');
      }

      await manager.update(
        User,
        { id: invitation.userId },
        { passwordHash, status: UserStatus.Active },
      );
    });

    this.logger.log(`Activated user ${invitation.userId} from invitation ${invitation.id}`);
  }

  /** Stores only the hash; the token itself exists in the returned value and the email. */
  private async issue(
    manager: EntityManager,
    userId: string,
    roleId: string,
    invitedById: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = addSeconds(new Date(), this.config.invitation.ttlSeconds);

    await manager.save(
      manager.create(Invitation, {
        tokenHash: this.hash(token),
        userId,
        roleId,
        invitedById,
        expiresAt,
      }),
    );

    return { token, expiresAt };
  }

  /** Nobody hands out a permission they do not hold; manage:all covers everything. */
  private async assertCanGrant(role: Role, callerId: string): Promise<void> {
    const caller = await this.users.findOne({ where: { id: callerId } });

    if (!caller) {
      throw new ForbiddenException();
    }

    const ability = this.abilities.createForUser(caller);
    const missing = role.permissions.find(({ action, subject }) => !ability.can(action, subject));

    if (missing) {
      this.logger.warn(
        `Refusing user ${callerId} inviting into role ${role.id}: ` +
          `caller lacks ${missing.action}:${missing.subject}`,
      );
      throw new ForbiddenException('You cannot grant a role with permissions you do not hold');
    }
  }

  private async findUsable(token: string): Promise<Invitation & { user: User }> {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: this.hash(token) },
      relations: { user: true },
    });

    // One message for every failure: a caller must not learn which tokens exist.
    if (!invitation?.user || invitation.acceptedAt || invitation.revokedAt) {
      throw new NotFoundException('This invitation is no longer valid');
    }

    if (isPast(invitation.expiresAt)) {
      throw new NotFoundException('This invitation is no longer valid');
    }

    if (invitation.user.status !== UserStatus.Invited) {
      throw new NotFoundException('This invitation is no longer valid');
    }

    return invitation;
  }

  private buildAcceptUrl(token: string): string {
    return `${this.config.invitation.acceptUrl}?token=${encodeURIComponent(token)}`;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
