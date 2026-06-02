
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity/user.entity';

@Entity({ name: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @Column({ name: 'replaced_by_token', nullable: true })
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
