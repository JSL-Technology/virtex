
import { CreateAccountDto } from "../../chart-of-accounts/dto/create-account.dto";
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import { LocalizationTemplate } from "./localization-template.entity";




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

    @ManyToOne(() => LocalizationTemplate, template => template.coaTemplate)
    template: LocalizationTemplate;
}