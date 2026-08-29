
import { CreateAccountDto } from "../../chart-of-accounts/dto/create-account.dto";
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import type { LocalizationTemplate } from "./localization-template.entity";
import type { FiscalRegion } from "./fiscal-region.entity";




export interface AccountTemplateDto extends Omit<CreateAccountDto, 'parentId'> {
    children?: AccountTemplateDto[];
}


@Entity({ name: 'coa_templates' })
export class CoaTemplate {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    countryCode: string;

    @Column({ type: 'jsonb' })
    accounts: AccountTemplateDto[];

    @ManyToOne('LocalizationTemplate', 'coaTemplate')
    template: LocalizationTemplate;

    /**
     * The region this chart-of-accounts template belongs to.
     *
     * `FiscalRegion.coaTemplates` declared `template => template.fiscalRegion` against a property
     * that did not exist, so the relation resolved from neither side.
     */
    @ManyToOne('FiscalRegion', 'coaTemplates', { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'fiscal_region_id', foreignKeyConstraintName: 'FK_coa_templates_fiscal_region' })
    fiscalRegion?: FiscalRegion;

    @Column({ name: 'fiscal_region_id', type: 'uuid', nullable: true })
    fiscalRegionId?: string;
}