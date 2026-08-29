
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity/user.entity';

@Entity({ name: 'refresh_tokens' })
@Index('IDX_refresh_tokens_session', ['sessionId'])
@Index('IDX_refresh_tokens_user_revoked', ['userId', 'isRevoked'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Stable identifier for the *session* (the refresh-token family, RFC 9700 §4.14.2), as opposed
   * to `id`, which identifies one link in the rotation chain.
   *
   * Every rotation creates a new row with a new `id` but inherits the family's `sessionId`. This
   * matters for two reasons:
   *
   *   1. The access-token `sessionId` claim stays stable for the life of the session, so the
   *      revocation denylist has something durable to key on. Keying on `id` would mean a
   *      routine rotation looked identical to a revocation.
   *   2. "Sesiones activas" in the UI can show one row per real device instead of one per
   *      rotation, and revoking one entry reliably kills that device's whole chain.
   */
  // No database default on purpose. TokenService always computes the family id before the row
  // is written, so a default would only ever mask the bug where it forgot to — a token
  // silently assigned to a session nothing else knows about. The transitional default that
  // allowed the column to be added to a populated table is dropped by the same migration
  // once the backfill completes.
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'is_revoked', default: false })
  isRevoked: boolean;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /**
   * Id of the token that superseded this one during rotation.
   *
   * Typed `uuid` rather than the default varchar because it holds `RefreshToken.id`, and
   * SessionService compares the two directly when it walks a rotation chain to find the family
   * root. With a varchar column Postgres rejects that comparison outright
   * ("operator does not exist: character varying = uuid"), so the chain walk could never run.
   */
  @Column({ name: 'replaced_by_token', type: 'uuid', nullable: true })
  replacedByToken?: string;

  @Column({ name: 'user_agent', nullable: true, type: 'text' })
  userAgent?: string;

  @Column({ name: 'ip_address', nullable: true })
  ipAddress?: string;

  @Column({ name: 'encrypted_ip', nullable: true, select: false })
  encryptedIp?: string;

  @Column({ nullable: true })
  browser?: string;

  @Column({ nullable: true })
  os?: string;

  @Column({ name: 'device_type', nullable: true })
  deviceType?: string;

  @Column({ nullable: true })
  country?: string;

  @Column({ nullable: true })
  city?: string;

  @Column({ nullable: true })
  region?: string;

  @Column({ type: 'float', nullable: true })
  latitude?: number;

  @Column({ type: 'float', nullable: true })
  longitude?: number;

  @Column({ name: 'last_active_at', type: 'timestamptz', nullable: true })
  lastActiveAt?: Date;

  @Column({ name: 'token_hash', nullable: true, select: false })
  tokenHash?: string;
}
