
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Column } from 'typeorm';
import { Dimension } from './dimension.entity';


export interface DimensionRuleCondition {
  sourceDimension: string;
  operator: 'EQUALS' | 'IN';
  values: string[];
}

@Entity({ name: 'dimension_rules' })
export class DimensionRule {
  @PrimaryColumn({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @PrimaryColumn({ type: 'uuid', name: 'dimension_id' })
  dimensionId: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @ManyToOne(() => Dimension, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dimension_id' })
  dimension: Dimension;
  
  @Column({ default: true })
  isRequired: boolean;


  @Column({ type: 'jsonb', nullable: true })
  conditions?: DimensionRuleCondition[];
}