
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  ManyToOne,
  JoinTable,
  OneToMany,
  OneToOne,
} from 'typeorm';
import type { Organization } from '../../../organizations/entities/organization.entity';
import { Role } from '../../../roles/entities/role.entity';
import { Passkey } from '../passkey.entity';
import { UserSecurity } from '../user-security.entity';

export enum UserStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
  BLOCKED = 'BLOCKED',
}

@Entity({ name: 'users' })
export class User {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  firstName: string;

  @Column({ length: 100 })
  lastName: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ name: 'auth_provider', nullable: true })
  authProvider?: string;

  @Column({ name: 'auth_provider_id', nullable: true })
  authProviderId?: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Column({ nullable: true })
  department?: string;

  @Column({ name: 'job_title', nullable: true })
  jobTitle?: string;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({ name: 'is_online', default: false })
  isOnline: boolean;

  @Column({ name: 'last_activity', type: 'timestamptz', nullable: true })
  lastActivity?: Date;

  @Column({ name: 'organization_id', type: 'varchar', nullable: true })
  organizationId: string | null;

  // Virtual property — populated manually by services, NOT a TypeORM relation.
  // TypeORM does not persist this field.
  organization?: Organization;

  // Virtual property — populated manually for multi-tenant access checks.
  organizations?: Array<{ id: string; legalName: string }>;

  @ManyToMany(() => Role, { eager: false })
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: Role[];

  permissions?: string[];

  isImpersonating?: boolean;
  originalUserId?: string;

  // Localization: Removing hardcoded default 'es'. Will be handled dynamically or by client preference.
  @Column({ name: 'preferred_language', length: 5, nullable: true })
  preferredLanguage?: string;

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  phone?: string | null;

  @Column({ name: 'is_phone_verified', default: false })
  isPhoneVerified: boolean;

  @Column({ name: 'is_email_verified', default: false })
  isEmailVerified: boolean;

  @OneToOne(() => UserSecurity, (security) => security.user, {
    cascade: true,
    eager: false,
  })
  security: UserSecurity;

  @Column({ nullable: true })
  invitationToken?: string;

  @Column({ type: 'timestamptz', nullable: true })
  invitationTokenExpires?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Passkey, (passkey) => passkey.user, { cascade: true })
  passkeys: Passkey[];
}
