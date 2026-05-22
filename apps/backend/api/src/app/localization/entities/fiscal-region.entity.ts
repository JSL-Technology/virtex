
import { Entity, PrimaryGeneratedColumn, Column, Index, OneToMany, ManyToMany, JoinTable } from 'typeorm';
import { TaxScheme } from './tax-scheme.entity';
import { TaxTemplate } from './tax-template.entity';
import { FiscalDocumentTypeDefinition } from './fiscal-document-type-definition.entity';
import { CoaTemplate } from './coa-template.entity';

@Entity({ name: 'fiscal_regions' })
export class FiscalRegion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 2 })
  countryCode: string;

  @Column()
  name: string;

  @Column({ length: 3 })
  baseCurrency: string;

  @OneToMany(() => TaxScheme, scheme => scheme.fiscalRegion)
  taxSchemes: TaxScheme[];

  // --- ENTERPRISE SAAS LOCALIZATION FEATURES ---

  // 1. Relación con Impuestos Predeterminados (Catálogo Maestro)
  @ManyToMany(() => TaxTemplate, template => template.fiscalRegions)
  @JoinTable({ name: 'fiscal_region_tax_templates' })
  defaultTaxes: TaxTemplate[];

  // 2. Formatos Regionales
  @Column({ default: 'dd/MM/yyyy' })
  dateFormat: string;

  @Column({ default: ',' })
  thousandSeparator: string;

  @Column({ default: '.' })
  decimalSeparator: string;

  // 3. Reglas de Negocio / Compliance
  @Column({ name: 'tax_id_name', default: 'Tax ID' })
  taxIdLabel: string; // 'RNC', 'NIT', 'EIN'

  @Column({ default: false })
  requiresElectronicInvoicing: boolean;

  @Column({ nullable: true })
  fiscalAuthorityName: string; // 'DGII', 'DIAN', 'IRS'

  @Column({ nullable: true })
  electronicInvoicingDriver: string; // 'DGII_V1', 'DIAN_V2'

  @Column({ default: false })
  requiresDigitalSignature: boolean;

  // 4. Tipos de Documentos Fiscales
  @OneToMany(() => FiscalDocumentTypeDefinition, def => def.fiscalRegion)
  documentDefinitions: FiscalDocumentTypeDefinition[];

  // 5. Validación de Terceros (JSONB for flexibility)
  @Column({ type: 'jsonb', nullable: true })
  identityDocumentConfig: {
    types: { code: string; label: string; regex: string; isCompany: boolean }[];
    validationApiUrl?: string;
  };

  // 6. Formatos de Dirección
  @Column({ default: 'State' })
  provinceLabel: string; // 'Provincia', 'Departamento', 'Estado'

  @Column({ nullable: true })
  postalCodeRegex: string;

  // 7. Reportes Legales
  @Column({ type: 'text', array: true, default: [] })
  requiredFiscalReports: string[];

  // 8. Relación con Plan de Cuentas (Existing idea, linking explicitly if needed, usually via CoaTemplate)
  @OneToMany(() => CoaTemplate, template => template.fiscalRegion)
  coaTemplates: CoaTemplate[];
}
