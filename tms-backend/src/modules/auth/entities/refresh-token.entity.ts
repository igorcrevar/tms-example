import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum TokenAudience {
  Staff = 'staff',
  Driver = 'driver',
}

/**
 * One row per issued refresh token. Rotation writes a new row and revokes the
 * old one; presenting a revoked row means the token leaked, so the whole
 * family is revoked.
 */
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Shared by every token descended from one login. */
  @Index('idx_refresh_tokens_family_id')
  @Column({ type: 'uuid' })
  familyId!: string;

  @Index('idx_refresh_tokens_user_id')
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: TokenAudience })
  audience!: TokenAudience;

  /** SHA-256 of the signed token; the token itself is never stored. */
  @Index('uq_refresh_tokens_token_hash', { unique: true })
  @Column({ type: 'char', length: 64 })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  replacedByTokenId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
