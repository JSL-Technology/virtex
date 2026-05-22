import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { FiscalRegion } from './fiscal-region.entity';

@Entity({ name: 'fiscal_document_type_definitions' })
export class FiscalDocumentTypeDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  code: string; // e.g., '01', 'B01'

  @Column()
  name: string; // e.g., 'Factura de Crédito Fiscal'

  @Column({ nullable: true })
  sequenceFormat: string; // e.g., 'B01########'

  @Column({ default: false })
  expirationRequired: boolean;

  @ManyToOne(() => FiscalRegion, region => region.documentDefinitions)
  fiscalRegion: FiscalRegion;
}
