import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Permission } from './permission.entity';

export enum RoleName {
  SuperAdmin = 'SUPER_ADMIN',
  Admin = 'ADMIN',
  Driver = 'DRIVER',
}

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_roles_name', { unique: true })
  @Column({ type: 'enum', enum: RoleName })
  name!: RoleName;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  /** Members sign in with a driver code and PIN: no password, no second factor, not invitable. */
  @Column({ type: 'boolean', default: false })
  pinLogin!: boolean;

  /** Members cannot be deleted, by anyone. */
  @Column({ type: 'boolean', default: false })
  isSuperAdmin!: boolean;

  @ManyToMany(() => Permission, { eager: true })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'roleId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permissionId', referencedColumnName: 'id' },
  })
  permissions!: Permission[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
