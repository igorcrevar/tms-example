import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';

import { configFor } from '../../config/app-config.fixture';
import { AbilityFactory } from '../auth/permissions/ability.factory';
import { PasswordService } from '../auth/services/password.service';
import { MailService } from '../mail/mail.service';
import { InviteUserDto } from '../user/dto';
import { PermissionAction, PermissionSubject } from '../user/entities/permission.entity';
import { Role, RoleName } from '../user/entities/role.entity';
import { User, UserStatus } from '../user/entities/user.entity';
import { Invitation } from './entities/invitation.entity';
import { InvitationService } from './invitation.service';

type Grant = [PermissionAction, PermissionSubject];

const CALLER = 'caller-1';
const INVITEE = 'user-2';
const TARGET_ROLE = 'role-2';

function roleWith(id: string, grants: Grant[], pinLogin = false): Role {
  return {
    id,
    pinLogin,
    permissions: grants.map(([action, subject]) => ({ action, subject })),
  } as unknown as Role;
}

describe('InvitationService', () => {
  const config = configFor({
    INVITATION_TTL: '1h',
    INVITATION_ACCEPT_URL: 'http://localhost:5173/admin/accept-invite',
  });
  const dto: InviteUserDto = {
    email: 'new@tms.local',
    firstName: 'New',
    lastName: 'Starter',
    role: RoleName.Admin,
  };

  let manager: { create: jest.Mock; save: jest.Mock; update: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let mail: { send: jest.Mock };

  function invitee(target: Role, status = UserStatus.Invited): Partial<User> {
    return {
      id: INVITEE,
      email: dto.email,
      firstName: dto.firstName,
      status,
      roleId: target.id,
      role: target,
    };
  }

  function buildService(callerGrants: Grant[], target: Role, existing?: Partial<User>) {
    const caller: Partial<User> = {
      id: CALLER,
      status: UserStatus.Active,
      role: roleWith('role-1', callerGrants),
    };
    const rows = [caller, ...(existing ? [existing] : [])];
    const users = {
      findOne: jest.fn((options: { where: { id?: string } }) =>
        Promise.resolve(rows.find((row) => row.id === options.where.id) ?? null),
      ),
    };
    const roles = { findOne: jest.fn().mockResolvedValue(target) };

    manager = {
      create: jest.fn((_entity: unknown, row: object) => row),
      save: jest.fn((row: object) =>
        Promise.resolve({ id: INVITEE, createdAt: new Date(), lastLoginAt: null, ...row }),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      transaction: jest.fn((run: (mng: EntityManager) => unknown) =>
        run(manager as unknown as EntityManager),
      ),
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };

    return new InvitationService(
      {} as unknown as Repository<Invitation>,
      users as unknown as Repository<User>,
      roles as unknown as Repository<Role>,
      new PasswordService(),
      mail as unknown as MailService,
      config,
      dataSource as unknown as DataSource,
      new AbilityFactory(),
    );
  }

  describe('invite', () => {
    it('refuses a role holding a permission the caller lacks', async () => {
      const service = buildService(
        [
          [PermissionAction.Manage, PermissionSubject.User],
          [PermissionAction.Manage, PermissionSubject.Driver],
        ],
        roleWith(TARGET_ROLE, [[PermissionAction.Manage, PermissionSubject.All]]),
      );

      await expect(service.invite(dto, CALLER)).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('lets a caller grant a role whose every permission they hold', async () => {
      const service = buildService(
        [
          [PermissionAction.Manage, PermissionSubject.User],
          [PermissionAction.Manage, PermissionSubject.Shipment],
        ],
        roleWith(TARGET_ROLE, [
          [PermissionAction.Read, PermissionSubject.User],
          [PermissionAction.Manage, PermissionSubject.Shipment],
        ]),
      );

      await service.invite(dto, CALLER);

      expect(manager.create).toHaveBeenCalledWith(
        User,
        expect.objectContaining({ roleId: TARGET_ROLE, status: UserStatus.Invited }),
      );
    });

    it('refuses a role that signs in with a PIN, since an invitation sets a password', async () => {
      const service = buildService(
        [[PermissionAction.Manage, PermissionSubject.All]],
        roleWith(TARGET_ROLE, [[PermissionAction.Read, PermissionSubject.Shipment]], true),
      );

      await expect(service.invite(dto, CALLER)).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('lets manage on all grant a role that holds manage on all', async () => {
      const service = buildService(
        [[PermissionAction.Manage, PermissionSubject.All]],
        roleWith(TARGET_ROLE, [[PermissionAction.Manage, PermissionSubject.All]]),
      );

      await expect(service.invite(dto, CALLER)).resolves.toMatchObject({ id: INVITEE });
    });
  });

  describe('resend', () => {
    const target = roleWith(TARGET_ROLE, [[PermissionAction.Read, PermissionSubject.User]]);
    const manageAll: Grant[] = [[PermissionAction.Manage, PermissionSubject.All]];

    it('revokes the outstanding links before storing a fresh hash, then mails it', async () => {
      const service = buildService(manageAll, target, invitee(target));

      await service.resend(INVITEE, CALLER);

      expect(manager.update).toHaveBeenCalledWith(
        Invitation,
        { userId: INVITEE, acceptedAt: IsNull(), revokedAt: IsNull() },
        { revokedAt: expect.any(Date) as Date },
      );
      expect(manager.create).toHaveBeenCalledWith(
        Invitation,
        expect.objectContaining({ userId: INVITEE, roleId: TARGET_ROLE, invitedById: CALLER }),
      );
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(
        manager.save.mock.invocationCallOrder[0],
      );
      expect(mail.send).toHaveBeenCalledWith(expect.objectContaining({ to: dto.email }));
    });

    it('refuses a user who has already accepted', async () => {
      const service = buildService(manageAll, target, invitee(target, UserStatus.Active));

      await expect(service.resend(INVITEE, CALLER)).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(mail.send).not.toHaveBeenCalled();
    });

    it("refuses a caller who could not grant the invitee's role", async () => {
      const service = buildService(
        [[PermissionAction.Read, PermissionSubject.Shipment]],
        target,
        invitee(target),
      );

      await expect(service.resend(INVITEE, CALLER)).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
