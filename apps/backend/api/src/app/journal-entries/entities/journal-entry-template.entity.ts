
import { Organization } from '../../organizations/entities/organization.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';


export class JournalEntryTemplateLine {
  accountId: string;
  description?: string;

  type: 'DEBIT' | 'CREDIT';

  /** Share of the amount on its side, in percent; absent on every line of a side, split equally. */
  percentage?: number;

  /** Analytic tags carried into the entry: `{"Centro de Costo": "VENTAS"}`. */
  dimensions?: Record<string, string> | null;
}

@Entity({ name: 'journal_entry_templates' })
export class JournalEntryTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column()
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb' })
  lines: JournalEntryTemplateLine[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
