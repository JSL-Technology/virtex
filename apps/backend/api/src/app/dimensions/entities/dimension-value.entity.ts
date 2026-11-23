
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import type { Dimension } from './dimension.entity';
import { NameTranslationsCheck, NameTranslationsColumn } from '../../common/database/name-translations.column';
import type { LocalizedName } from '@virtex/shared/types';

@Entity({ name: 'dimension_values' })
@NameTranslationsCheck('dimension_values')
@Index(['dimension', 'value'], { unique: true })
export class DimensionValue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The code a journal line carries: `VENTAS`. Immutable once lines carry it. */
  @Column()
  value: string;

  /** Its label: «Departamento de ventas». The code alone when absent. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  name: string | null;

  /** The name in the languages other than the books' (books bilingual): see `NameTranslationsColumn`. */
  @NameTranslationsColumn()
  nameTranslations: LocalizedName;

  /** An inactive value is retired: lines keep it, new lines cannot be given it. */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @ManyToOne('Dimension', 'values', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dimension_id' })
  dimension: Dimension;
  
  @Column({ name: 'dimension_id' })
  dimensionId: string;

  /**
   * The hierarchy is this column, as it is for accounts: a closure table kept beside it was never
   * read, and a second copy of a fact is one more thing that drifts (FIN-COA-04).
   */
  @ManyToOne(() => DimensionValue, (value) => value.children, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: DimensionValue | null;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @OneToMany(() => DimensionValue, (value) => value.parent)
  children: DimensionValue[];
}