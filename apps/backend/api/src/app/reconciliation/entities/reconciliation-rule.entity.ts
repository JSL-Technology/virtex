import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum RuleConditionField {
    DESCRIPTION = 'DESCRIPTION',
    AMOUNT = 'AMOUNT',
}

export enum RuleConditionOperator {
    CONTAINS = 'CONTAINS',
    EQUALS = 'EQUALS',
    STARTS_WITH = 'STARTS_WITH',
}

@Entity({ name: 'reconciliation_rules' })
export class ReconciliationRule {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'organization_id' })
    organizationId: string;
    
    @Column()
    name: string;

    @Column({ type: 'enum', enum: RuleConditionField })
    conditionField: RuleConditionField;
    
    @Column({ type: 'enum', enum: RuleConditionOperator })
    conditionOperator: RuleConditionOperator;

    @Column()
    conditionValue: string;
    
    @Column({ name: 'target_account_id' })
    targetAccountId: string;
}