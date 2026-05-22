
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, Tree, TreeChildren, TreeParent } from 'typeorm';
import { Dimension } from './dimension.entity';

@Entity({ name: 'dimension_values' })
@Tree('closure-table')
@Index(['dimension', 'value'], { unique: true })
export class DimensionValue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  value: string;

  @ManyToOne(() => Dimension, (dimension) => dimension.values, { onDelete: 'CASCADE' })
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