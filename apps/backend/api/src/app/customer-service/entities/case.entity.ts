import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity/user.entity';

export enum CaseStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

@Entity({ name: 'cases' })
export class Case {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column()
  subject: string;
  
  @Column({type: 'text'})
  description: string;

  @Column({ type: 'enum', enum: CaseStatus, default: CaseStatus.OPEN })
  status: CaseStatus;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo: User;

  @CreateDateColumn()
  createdAt: Date;
}