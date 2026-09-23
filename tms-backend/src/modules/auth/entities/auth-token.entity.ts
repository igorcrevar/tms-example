import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../user/entities/user.entity';

export enum AuthTokenPurpose {
  PasswordReset = 'PASSWORD_RESET',
}

/**
 * Short-lived, single-use tokens emailed to a user. Every lookup filters on
 * `purpose`, so a token issued for one flow cannot be spent on another.
 */
@Entity('auth_tokens')
@Index('ix_auth_tokens_user_purpose', ['userId', 'purpose'])
export class AuthToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** SHA-256 of the emailed token; the token itself is never stored. */
  @Index('uq_auth_tokens_token_hash', { unique: true })
  @Column({ type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ type: 'enum', enum: AuthTokenPurpose })
  purpose!: AuthTokenPurpose;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
