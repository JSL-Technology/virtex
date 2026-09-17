
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
  //
  // `tax_id_name` used to live here, holding the WORD — 'RNC', 'NIT', 'EIN' — with a DEFAULT of
  // 'Tax ID' in English, so anything rendering it showed untranslatable text. It is gone rather
  // than renamed: what a country calls its identifier is now an attribute of the catalogue entry
  // for that identifier (`identity_document_types.label_key` / `label_verbatim`), where it sits
  // beside the pattern and the checksum it belongs with, instead of being a loose word on the
  // region.

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

  // 5. Validación de Terceros
  //
  // `identity_document_config` was a JSONB column shaped like the catalogue this product needed —
  // `{ types: [{ code, label, regex, isCompany }] }` — seeded on every boot and read by nothing
  // but a fallback strategy whose `validateTaxId` ended in `return true`. It could hold at most
  // two entries per country (populated for two of nineteen), its `code` was derived from the
  // label by stripping non-ASCII (`'RNC / Cédula'` became `RNCCDULA`), `isCompany` was a boolean
  // and so could not express a Chilean RUT that identifies both, and it carried no check digit.
  //
  // It is replaced by `identity_document_types`, a real table with a natural key, a named
  // checksum algorithm, a ternary `applies_to` and a usage context — and, unlike this column,
  // consumers: HCM, sales, purchasing and registration all read it.

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
