
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Tree,
  TreeChildren,
  TreeParent,
  Index,
  VersionColumn,
  OneToMany,
} from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import {
  AccountType,
  AccountCategory,
  AccountNature,
  AccountRole,
} from '../enums/account-enums';
import { AccountSegment } from './account-segment.entity';

import { AccountHierarchyVersion } from './account-hierarchy-version.entity';


export * from '../enums/account-enums';

@Entity({ name: 'accounts' })
@Tree('closure-table')
@Index(['organizationId'])
// One account per operational role per tenant: the automatic postings resolve a role to exactly one
// account, and two candidates would make the choice arbitrary.
@Index('UQ_accounts_org_system_role', ['organizationId', 'systemRole'], {
  unique: true,
  where: '"system_role" IS NOT NULL',
})
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'jsonb',
    comment: 'Almacena las traducciones del nombre de la cuenta. Ej: { "es": "Efectivo", "en": "Cash" }',
  })
  name: Record<string, string>;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: 'Almacena las traducciones de la descripción de la cuenta.',
  })
  description?: Record<string, string>;
  
  @Column({ type: 'enum', enum: AccountType })
  type: AccountType;

  @Column({ type: 'enum', enum: AccountCategory })
  category: AccountCategory;

  @Column({
    type: 'enum',
    enum: AccountNature,
    comment: 'Naturaleza contable derivada del tipo de cuenta (Débito o Crédito)',
  })
  nature: AccountNature;

  /**
   * A contra account: its normal balance is the OPPOSITE of what its type implies.
   *
   * Accumulated depreciation is an asset with a credit balance; an allowance for doubtful accounts
   * is an asset with a credit balance; sales returns are revenue with a debit balance. Without
   * this flag the only consistent rule available was "nature must equal the type's normal
   * nature", which `ChartOfAccountsService` enforced — and which makes those three accounts
   * impossible to create. Every IFRS opening chart needs all three, so the rule rejected the
   * product's own templates.
   *
   * Stored rather than derived so financial statements can net a contra account against its
   * siblings instead of inferring intent from a mismatch.
   */
  @Column({
    name: 'is_contra_account',
    default: false,
    comment: 'Cuenta de naturaleza contraria a su tipo (depreciación acumulada, provisiones, devoluciones).',
  })
  isContraAccount: boolean;

  /**
   * The operational job this account does, for the automatic postings that must find it.
   *
   * Nullable because most accounts have none; unique per organization where present, so the
   * product can resolve "the receivable account" without matching on a localized name or a code
   * that a statutory plan would write differently. See {@link AccountRole}.
   */
  @Column({ name: 'system_role', type: 'varchar', length: 40, nullable: true })
  systemRole: AccountRole | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false, comment: 'Indica si se pueden registrar transacciones en esta cuenta.' })
  isPostable: boolean;
  
  @Column({ default: false, comment: 'Las cuentas de sistema no pueden ser modificadas o eliminadas por los usuarios.' })
  isSystemAccount: boolean;


  @TreeParent({ onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_id' })
  parent: Account | null;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @TreeChildren()
  children: Account[];

  @OneToMany(() => AccountSegment, (segment) => segment.account, { cascade: true, eager: true })
  segments: AccountSegment[];


  /**
   * There is deliberately no `balances` relation.
   *
   * A balance is a `SUM` over the journal, served by `AccountBalancesService`. Hanging it off the
   * account as a stored relation is what allowed the close to read a figure that did not include
   * the entries the close had just posted.
   */

  @OneToMany(() => AccountHierarchyVersion, (version) => version.account, { cascade: true })
  history: AccountHierarchyVersion[];


  @Column({ default: false, name: 'is_multi_currency' })
  isMultiCurrency: boolean;

  @Column({ length: 3, nullable: true, comment: 'Código de moneda ISO 4217 si la cuenta es de moneda única extranjera.' })
  currency?: string;

  @Column({ default: false, name: 'is_inflation_adjustable' })
  isInflationAdjustable: boolean;


  @Column({ name: 'effective_from', type: 'date', default: () => 'CURRENT_DATE' })
  effectiveFrom: Date;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo?: Date;


  @Column({ name: 'is_blocked_for_posting', default: false })
  isBlockedForPosting: boolean;

  @Column({ name: 'blocked_at', type: 'timestamptz', nullable: true })
  blockedAt: Date | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'blocked_by_user_id' })
  blockedBy: User | null;

  @Column({ name: 'blocked_by_user_id', type: 'uuid', nullable: true })
  blockedByUserId: string | null;


  @Column({ type: 'jsonb', nullable: true, name: 'statement_mapping', comment: 'Configuración para mapeo en estados financieros.' })
  statementMapping?: {
    balanceSheetCategory?: string;
    incomeStatementCategory?: string;
    cashFlowCategory?: string;
  };
  
  @Column({ type: 'jsonb', nullable: true, name: 'custom_fields', comment: 'Almacena campos personalizados definidos por el usuario.' })
  customFields?: Record<string, any>;


  @ManyToOne(() => Organization, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'organization_id' })
  organizationId: string;


  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @VersionColumn({ comment: 'Versión para bloqueo optimista y prevención de condiciones de carrera.' })
  version: number;

  get code(): string {
    if (!this.segments || this.segments.length === 0) {
      return '';
    }

    return this.segments
      .sort((a, b) => a.order - b.order)
      .map(s => s.value)
      .join('-');
  }
}