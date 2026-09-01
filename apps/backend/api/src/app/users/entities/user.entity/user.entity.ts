
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  ManyToOne,
  JoinTable,
  JoinColumn,
  OneToMany,
  OneToOne,
  Index,
} from 'typeorm';
import type { Organization } from '../../../organizations/entities/organization.entity';
import { Role } from '../../../roles/entities/role.entity';
import { Passkey } from '../passkey.entity';
import { UserSecurity } from '../user-security.entity';
import type { LanguageCode } from '@virteex/shared/types';

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

  /**
   * The tenant this person is currently acting in.
   *
   * A real uuid with a real foreign key. It was a bare `varchar` with no constraint, so a value
   * referencing no organization was storable — and the resulting user authenticated into a tenant
   * that did not exist. Every other membership lives in `user_organizations`; this column names
   * which of them is active.
   */
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  /**
   * The active tenant, as a real relation.
   *
   * It used to be a plain untyped property that services populated by hand, with a comment warning
   * that passing it in `relations` throws `EntityPropertyNotFoundError` — which it did, and which
   * cost a transaction in `completePendingRegistration` before somebody worked out why. Declaring
   * the relation is what lets the column carry a foreign key at all, and it makes
   * `relations: ['organization']` work the way every reader expects.
   *
   * Not eager: the hot authentication path loads a projection, not the entity, and an eager join
   * on every user read would be a cost paid on every request for a value most of them ignore.
   */
  // The target is named by string rather than by constructor: `Organization` is a type-only
  // import here to break the cycle between the users and organizations modules, so there is no
  // runtime value to reference.
  @ManyToOne('Organization', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_users_organization' })
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

  /**
   * The interface language this person chose, or null if they never chose one.
   *
   * Deliberately nullable with no database default. A default here would be indistinguishable
   * from a real choice, and the server would then have no way to tell "this user wants Spanish"
   * from "nobody ever asked" — so it could never honour an `Accept-Language` header without
   * overriding what looks like a preference. Null means unanswered; the resolver negotiates.
   *
   * The column stays `length: 5` to leave room for a future regional preference (`pt-BR`)
   * without a migration; the values written today are the two-letter catalogue codes.
   */
  @Column({ name: 'preferred_language', length: 5, nullable: true })
  preferredLanguage?: LanguageCode | null;

  /**
   * Not unique across the platform. Nothing looks an account up by phone, and a shared company
   * switchboard is the ordinary case in these markets — a global constraint refused the second
   * employee to save their profile and bought nothing in return. Indexed, because administration
   * screens filter on it.
   */
  @Index('IDX_users_phone')
  @Column({ type: 'varchar', length: 20, nullable: true })
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
