
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Account } from './account.entity';

@Entity({ name: 'account_segments' })
@Index(['account', 'order'])
export class AccountSegment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Account, account => account.segments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ type: 'int', comment: 'The order of the segment in the account code (e.g., 0, 1, 2)' })
  order: number;

  @Column({ type: 'varchar', length: 50, comment: 'The value of the segment (e.g., "1101", "01")' })
  value: string;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: 'Optional description for the segment type (e.g., "Cuenta Mayor", "Centro de Costo")' })
  description?: string;
}
