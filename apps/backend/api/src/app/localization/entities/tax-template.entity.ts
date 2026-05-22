
import { CreateTaxDto } from "../../taxes/dto/create-tax.dto";
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, ManyToMany } from "typeorm";
import { LocalizationTemplate } from "./localization-template.entity";
import { FiscalRegion } from "./fiscal-region.entity";

@Entity({ name: 'tax_templates' })
export class TaxTemplate {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    countryCode: string;

    @Column()
    name: string; // Added name for identification

    @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
    rate: number;

    @Column({ default: 'VAT' })
    type: string;

    @ManyToOne(() => LocalizationTemplate, template => template.taxTemplates)
    template: LocalizationTemplate;

    @ManyToMany(() => FiscalRegion, region => region.defaultTaxes)
    fiscalRegions: FiscalRegion[];
}
