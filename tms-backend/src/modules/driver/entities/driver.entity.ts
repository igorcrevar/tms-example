import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../user/entities/user.entity';

export enum DriverType {
  Truck = 'TRUCK',
  Train = 'TRAIN',
}

@Entity('drivers')
export class Driver {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The identifier a driver types at the keypad; short and human-readable. */
  @Index('uq_drivers_driver_code', { unique: true, where: '"deletedAt" IS NULL' })
  @Column({ type: 'varchar', length: 32 })
  driverCode!: string;

  @Index('uq_drivers_user_id', { unique: true, where: '"deletedAt" IS NULL' })
  @Column({ type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: DriverType })
  driverType!: DriverType;

  @Column({ type: 'varchar', length: 255, select: false })
  pinHash!: string;

  @Column({ type: 'timestamptz', nullable: true })
  pinUpdatedAt!: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  licenseNumber!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
