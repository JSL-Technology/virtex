
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, Tree, TreeChildren, TreeParent } from 'typeorm';
import type { Dimension } from './dimension.entity';

@Entity({ name: 'dimension_values' })
@Tree('closure-table')
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

  /** An inactive value is retired: lines keep it, new lines cannot be given it. */
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @ManyToOne('Dimension', 'values', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dimension_id' })
  dimension: Dimension;
  
  @Column({ name: 'dimension_id' })
  dimensionId: string;

  @TreeParent({ onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent: DimensionValue | null;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @TreeChildren()
  children: DimensionValue[];
}