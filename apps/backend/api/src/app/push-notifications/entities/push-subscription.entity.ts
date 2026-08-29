import { User } from '../../users/entities/user.entity/user.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';


@Entity()
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  endpoint: string;

  @Column()
  p256dh: string;

  @Column()
  auth: string;

  @ManyToOne(() => User)
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
