import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Role } from './role.entity';

export enum UserStatus {
  Invited = 'INVITED',
  Active = 'ACTIVE',
  Suspended = 'SUSPENDED',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Stored lower-cased; every lookup must normalise first. Unique only among
   * live rows, so a soft-deleted person's address can be invited again.
   */
  @Index('uq_users_email', { unique: true, where: '"deletedAt" IS NULL' })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ type: 'varchar', length: 100 })
  lastName!: string;

  // select: false keeps the hash out of every query that does not ask for it.
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash!: string | null;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Invited })
  status!: UserStatus;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  totpSecret!: string | null;

  /** Set once the user has confirmed a code; null means enrolment is pending. */
  @Column({ type: 'timestamptz', nullable: true })
  totpEnabledAt!: Date | null;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => Role, { eager: true })
  @JoinColumn({ name: 'roleId' })
  role!: Role;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  /** Set by a soft delete; a row with this set must never authenticate. */
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
