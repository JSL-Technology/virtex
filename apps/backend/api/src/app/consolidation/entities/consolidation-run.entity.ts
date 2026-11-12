import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

/** One consolidation, as computed and stored (FINB-34). Append-only. */
@Entity({ name: 'consolidation_runs' })
@Index('IDX_consolidation_runs_org_date', ['organizationId', 'asOfDate', 'createdAt'])
@Check('CHK_consolidation_runs_period', `"start_date" <= "as_of_date"`)
export class ConsolidationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The parent: the group's statements belong to it. */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  // By name: the entity is the organizations module's (verify:boundaries).
  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_consolidation_runs_organization' })
  organization?: unknown;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'as_of_date', type: 'date' })
  asOfDate: string;

  @Column({ name: 'presentation_currency', type: 'varchar', length: 3 })
  presentationCurrency: string;

  @Column({ name: 'is_balanced', type: 'boolean' })
  isBalanced: boolean;

  @Column('decimal', { name: 'total_assets', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  totalAssets: number;

  @Column('decimal', { name: 'total_equity', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  totalEquity: number;

  @Column('decimal', { name: 'non_controlling_interests', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  nonControllingInterests: number;

  @Column('decimal', { precision: 18, scale: 2, transformer: numericTransformerNotNull })
  goodwill: number;

  /** The cumulative translation reserve at the reporting date: its history is the list of runs. */
  @Column('decimal', { name: 'translation_reserve', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  translationReserve: number;

  @Column('decimal', { name: 'net_income', precision: 18, scale: 2, transformer: numericTransformerNotNull })
  netIncome: number;

  @Column({ name: 'warning_count', type: 'int' })
  warningCount: number;

  /** The full statements, eliminations and warnings as computed. */
  @Column({ type: 'jsonb' })
  result: unknown;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
