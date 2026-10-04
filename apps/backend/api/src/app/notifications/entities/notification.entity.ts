import { User } from '../../users/entities/user.entity/user.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, Index } from 'typeorm';

/**
 * One in-app notification.
 *
 * ## Why it stores a key AND a rendering
 *
 * It used to store only the rendering — Spanish text written at the moment the event fired — so a
 * dunning notice reached an English-speaking administrator in Spanish, and stayed in Spanish
 * however they later set their language. `titleKey`/`bodyKey`/`params` say what the message MEANS,
 * and the reader's language decides how it reads, on every read.
 *
 * `title` and `body` stay because two things genuinely need text at write time: a web-push payload
 * leaves the system immediately and cannot be re-rendered, and rows created before this existed
 * have nothing else. Reading prefers the keys and falls back to the text.
 */
@Entity()
@Index('IDX_notification_user_org_created', ['userId', 'organizationId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Rendering made when the notification was created. Read only when `titleKey` is null. */
  // The comment is declared, not just written in the docstring: a migration set it on the column
  // and the entity did not, which the schema-drift gate reported on every run.
  @Column({
    comment: 'Rendering made when the notification was created. Read only when title_key is null.',
  })
  title: string;

  @Column()
  body: string;

  /** Catalogue key for the title. Null on rows created before notifications were localised. */
  @Column({ name: 'title_key', type: 'varchar', length: 160, nullable: true })
  titleKey?: string | null;

  @Column({ name: 'body_key', type: 'varchar', length: 160, nullable: true })
  bodyKey?: string | null;

  /** Interpolation parameters for both keys. */
  @Column({ type: 'jsonb', nullable: true })
  params?: Record<string, unknown> | null;

  @Column({ default: false })
  read: boolean;

  /** The company the notice is about; null for a notice about the person (their own account). */
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null;

  // Tenant-owned: deleting the tenant deletes its notices (see TenantOwned).
  @TenantOwned('FK_notification_organization')
  organization?: TenantRef;

  /** Where the notice leads in the client — an app path such as `/approvals`. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  link?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => User)
  user: User;

  @Column()
  userId: string;
}
