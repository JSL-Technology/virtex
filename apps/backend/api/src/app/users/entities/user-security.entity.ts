
import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity/user.entity';

@Entity({ name: 'user_security' })
export class UserSecurity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @OneToOne(() => User, user => user.security, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    nullable: true,
  })
  passwordHash?: string | null;

  @Column({
    name: 'token_version',
    type: 'integer',
    default: 0,
    comment: 'Incrementado para invalidar todos los JWT emitidos previamente.',
  })
  tokenVersion: number;

  @Column({ name: 'failed_login_attempts', type: 'integer', default: 0 })
  failedLoginAttempts: number;

  @Column({ name: 'lockout_until', type: 'timestamptz', nullable: true })
  lockoutUntil: Date | null;

  @Column({
    name: 'password_reset_token',
    type: 'varchar',
    nullable: true,
  })
  passwordResetToken?: string | null;

  @Column({ name: 'password_reset_expires', type: 'timestamp', nullable: true })
  passwordResetExpires?: Date | null;

  @Column({ name: 'is_two_factor_enabled', default: false })
  isTwoFactorEnabled: boolean;

  @Column({ name: 'two_factor_secret', type: 'varchar', nullable: true })
  twoFactorSecret?: string;

  // 10/10 SECURITY: Backup Codes
  // Stored as a hashed array or simpler: plain text is DANGEROUS.
  // We will store them hashed (argon2) individually in a separate table OR
  // for simplicity in this task, a JSON column with hashed values is acceptable if properly handled.
  // Better approach: Store them as a JSON array of HASHED codes.
  @Column('jsonb', { name: 'backup_codes', nullable: true })
  backupCodes?: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
