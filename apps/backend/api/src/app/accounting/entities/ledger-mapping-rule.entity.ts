
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, OneToMany } from 'typeorm';
import { Ledger } from './ledger.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { LedgerMappingRuleCondition } from './ledger-mapping-rule-condition.entity';

@Entity({ name: 'ledger_mapping_rules' })
@Index(['sourceLedgerId', 'targetLedgerId', 'sourceAccountId'], { unique: true })
export class LedgerMappingRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

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

  @Column('decimal', { precision: 18, scale: 6, default: 1.0 })
  multiplier: number;


  @OneToMany(() => LedgerMappingRuleCondition, (condition) => condition.rule, { cascade: true })
  conditions: LedgerMappingRuleCondition[];
}