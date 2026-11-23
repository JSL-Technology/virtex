
import { Organization } from '../../organizations/entities/organization.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';
import { DimensionValue } from './dimension-value.entity';
import { NameTranslationsCheck, NameTranslationsColumn } from '../../common/database/name-translations.column';
import type { LocalizedName } from '@virtex/shared/types';

@Entity({ name: 'dimensions' })
@NameTranslationsCheck('dimensions')
@Index(['organizationId', 'name'], { unique: true })
export class Dimension {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * What a journal line is tagged with: `{"Centro de Costo": "VENTAS"}`. Immutable once lines
   * carry it — see `DimensionsService.update`.
   */
  @Column()
  name: string;

  /** The name in the languages other than the books' (books bilingual): see `NameTranslationsColumn`. */
  @NameTranslationsColumn()
  nameTranslations: LocalizedName;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** An inactive dimension can no longer be put on a line; the lines that carry it keep it. */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @OneToMany(() => DimensionValue, (value) => value.dimension, { cascade: true })
  values: DimensionValue[];
}
