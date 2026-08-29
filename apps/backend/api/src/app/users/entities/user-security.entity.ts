
import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import type { User } from './user.entity/user.entity';

@Entity({ name: 'user_security' })
export class UserSecurity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @OneToOne('User', 'security', { onDelete: 'CASCADE' })
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
  twoFactorSecret?: string | null;

  /**
   * A-5: secret for an enrolment that has been started but not yet confirmed.
   *
   * Enrolment used to write straight into `two_factor_secret`, even when 2FA was already active
   * and even though POST /2fa/generate required nothing beyond a valid session. Anyone holding a
   * hijacked session could overwrite the secret; `is_two_factor_enabled` stayed true, so the
   * legitimate owner's authenticator silently stopped matching and they were locked out of their
   * own account. Staging the candidate here means a started-but-abandoned enrolment can never
   * disturb the working one.
   */
  @Column({ name: 'pending_two_factor_secret', type: 'varchar', nullable: true })
  pendingTwoFactorSecret?: string | null;

  /**
   * A-6: the last TOTP time-step accepted for this user, for replay protection.
   *
   * A TOTP code stays valid for its whole step (plus the skew window), so without recording what
   * was already spent the same six digits can be replayed repeatedly within that window — which
   * matters because the same code also authorises sensitive actions through
   * step-up re-authentication. NIST SP 800-63B §5.1.4.2 requires the verifier to reject an OTP that
   * has already been used.
   */
  @Column({ name: 'last_totp_step', type: 'bigint', nullable: true })
  lastTotpStep?: string | null;

  // 10/10 SECURITY: Backup Codes
  // Stored as a hashed array or simpler: plain text is DANGEROUS.
  // We will store them hashed (argon2) individually in a separate table OR
  // for simplicity in this task, a JSON column with hashed values is acceptable if properly handled.
  // Better approach: Store them as a JSON array of HASHED codes.
  @Column('jsonb', { name: 'backup_codes', nullable: true })
  backupCodes?: string[] | null;

  // H-01 FIX: Email-change confirmation fields.
  // The new email is never applied directly — it's stored here pending token
  // verification, then swapped in one atomic operation that also bumps tokenVersion.
  @Column({ name: 'email_change_token', type: 'varchar', nullable: true })
  emailChangeToken?: string | null;

  @Column({ name: 'email_change_target', type: 'varchar', length: 254, nullable: true })
  emailChangeTarget?: string | null;

  @Column({ name: 'email_change_expires', type: 'timestamptz', nullable: true })
  emailChangeExpires?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
