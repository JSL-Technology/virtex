
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class VendorDebitNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;


  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column()
  vendorBillId: string;

  @Column()
  reason: string;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;


  @CreateDateColumn({ type: 'date' })
  date: Date;
}