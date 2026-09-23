import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum PermissionAction {
  Manage = 'manage',
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
}

export enum PermissionSubject {
  All = 'all',
  User = 'User',
  Role = 'Role',
  Driver = 'Driver',
  Shipment = 'Shipment',
  Vehicle = 'Vehicle',
}

@Entity('permissions')
@Unique('uq_permissions_action_subject', ['action', 'subject'])
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: PermissionAction })
  action!: PermissionAction;

  @Column({ type: 'enum', enum: PermissionSubject })
  subject!: PermissionSubject;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;
}
