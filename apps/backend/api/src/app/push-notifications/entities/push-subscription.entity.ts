import { User } from '../../users/entities/user.entity/user.entity';
import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne } from 'typeorm';


/** One row per browser endpoint: an endpoint identifies a browser profile, not a user. */
@Entity()
@Index('UQ_push_subscription_endpoint', ['endpoint'], { unique: true })
@Index('IDX_push_subscription_user', ['userId'])
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 2048 })
  endpoint: string;

  @Column()
  p256dh: string;

  @Column()
  auth: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: string;

  /**
   * The shape the Web Push protocol defines.
   *
   * The columns are flat for storage; `web-push` takes `{ endpoint, keys: { p256dh, auth } }`, and
   * the entity was being handed to it unchanged.
   */
  toWebPushSubscription(): { endpoint: string; keys: { p256dh: string; auth: string } } {
    return { endpoint: this.endpoint, keys: { p256dh: this.p256dh, auth: this.auth } };
  }
}
