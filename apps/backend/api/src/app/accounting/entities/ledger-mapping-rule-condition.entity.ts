
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { LedgerMappingRule } from './ledger-mapping-rule.entity';

export enum RuleConditionOperator {
  EQUALS = 'EQUALS',
  NOT_EQUALS = 'NOT_EQUALS',
  IN = 'IN',




}

@Entity({ name: 'ledger_mapping_rule_conditions' })
@Index(['rule'])
export class LedgerMappingRuleCondition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'dimension_name',
    comment: 'El nombre de la dimensión a evaluar (ej. "Proyecto").',
  })
  dimensionName: string;

  @Column({
    type: 'enum',
    enum: RuleConditionOperator,
    comment: 'El operador de comparación a utilizar (EQUALS, IN, etc.).',
  })
  operator: RuleConditionOperator;

  @Column({
    type: 'simple-array',
    comment: 'El/los valor(es) con los que se comparará la dimensión.',
  })
  values: string[];

  @ManyToOne(() => LedgerMappingRule, (rule) => rule.conditions, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'rule_id' })
  rule: LedgerMappingRule;

  @Column({ name: 'rule_id' })
  ruleId: string;
}