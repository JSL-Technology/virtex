
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export type JournalType = 'SALES' | 'PURCHASES' | 'CASH' | 'BANK' | 'GENERAL';

@Entity({ name: 'journals' })
@Index(['organizationId', 'code'], { unique: true })
export class Journal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ length: 10 })
  code: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar' })
  type: JournalType;
}