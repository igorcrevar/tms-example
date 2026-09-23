import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Role } from '../../user/entities/role.entity';
import { User } from '../../user/entities/user.entity';

/**
 * Issued when an admin invites someone. The invited `User` row already exists
 * with status INVITED, so a pending person still appears in the user list.
 */
@Entity('invitations')
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** SHA-256 of the emailed token; the token itself is never stored. */
  @Index('uq_invitations_token_hash', { unique: true })
  @Column({ type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => Role)
  @JoinColumn({ name: 'roleId' })
  role!: Role;

  @Column({ type: 'uuid' })
  invitedById!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
