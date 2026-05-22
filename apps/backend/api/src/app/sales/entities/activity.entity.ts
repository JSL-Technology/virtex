import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity/user.entity';

export enum ActivityType {
  CALL = 'CALL',
  MEETING = 'MEETING',
  EMAIL = 'EMAIL',
  OTHER = 'OTHER',
}

@Entity({ name: 'activities' })
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer?: Customer;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: ActivityType })
  type: ActivityType;

  @Column()
  subject: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'timestamptz' })
  activityTimestamp: Date;

  @CreateDateColumn()
  createdAt: Date;
}