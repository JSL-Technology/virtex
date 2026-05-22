import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum ReportFormat {
  XML = 'XML',
  TXT = 'TXT',
  JSON = 'JSON',
}

@Entity({ name: 'report_definitions' })
export class ReportDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  fiscalRegionId: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: ReportFormat })
  format: ReportFormat;

  @Column({ type: 'text' })
  template: string;

  @Column({ type: 'jsonb' })
  mappings: Record<string, string>;

  @Column({ type: 'jsonb', nullable: true })
  validationRules?: Record<string, any>;
}