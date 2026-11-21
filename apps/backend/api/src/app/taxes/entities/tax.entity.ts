import type { TaxGroup } from '../../localization/entities/tax-group.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

export enum TaxType {
  PERCENTAGE = 'Porcentaje',
  FIXED = 'Fijo',
}

@Entity({ name: 'taxes' })
@Check('CHK_taxes_period', `"effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from"`)
export class Tax {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, transformer: numericTransformerNotNull })
  rate: number;

  @Column({
    type: 'enum',
    enum: TaxType,
    default: TaxType.PERCENTAGE,
  })
  type: TaxType;

  @Column({ nullable: true })
  countryCode?: string;

  /**
   * The period this rate may be applied in (audit 2026-11-07, LOC-06). A document dated outside it
   * cannot use it. Null bounds are open; a seeded rate starts when the statutory rate it mirrors
   * entered into force.
   */
  @Column({ name: 'effective_from', type: 'date', nullable: true })
  effectiveFrom?: string | null;

  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;



   @ManyToOne('TaxGroup', 'taxes', { nullable: true, onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'tax_group_id' })
  taxGroup?: TaxGroup;

  @Column({ name: 'tax_group_id', type: 'uuid', nullable: true })
  taxGroupId?: string;
}
