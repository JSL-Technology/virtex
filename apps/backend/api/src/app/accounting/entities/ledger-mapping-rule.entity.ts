
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, OneToMany } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';
import { Ledger } from './ledger.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { LedgerMappingRuleCondition } from './ledger-mapping-rule-condition.entity';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

@Entity({ name: 'ledger_mapping_rules' })
@Index(['sourceLedgerId', 'targetLedgerId', 'sourceAccountId'], { unique: true })
export class LedgerMappingRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * `uuid`, matching `organizations.id`, with a foreign key.
   *
   * Twenty tables held the tenant reference as `character varying` while the column it points at
   * is a uuid. A join between them was a type error PostgreSQL refused outright, and a row whose
   * organization had been deleted was perfectly storable.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'source_ledger_id' })
  sourceLedgerId: string;

  @ManyToOne(() => Ledger, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_ledger_id' })
  sourceLedger: Ledger;

  @Column({ name: 'target_ledger_id' })
  targetLedgerId: string;

  @ManyToOne(() => Ledger, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_ledger_id' })
  targetLedger: Ledger;

  @Column({ name: 'source_account_id' })
  sourceAccountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_account_id' })
  sourceAccount: Account;
  
  @Column({ name: 'target_account_id' })
  targetAccountId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_account_id' })
  targetAccount: Account;

  @Column('decimal', { precision: 18, scale: 6, default: 1.0, transformer: numericTransformerNotNull })
  multiplier: number;


  @OneToMany(() => LedgerMappingRuleCondition, (condition) => condition.rule, { cascade: true })
  conditions: LedgerMappingRuleCondition[];
}