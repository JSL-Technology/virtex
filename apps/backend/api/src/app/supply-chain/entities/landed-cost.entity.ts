
import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

export enum LandedCostAllocationMethod {
  VALUE = 'VALUE',
  WEIGHT = 'WEIGHT',
  VOLUME = 'VOLUME',
  QUANTITY = 'QUANTITY'
}

@Entity('landed_costs')
export class LandedCost extends BaseEntity {
  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: LandedCostAllocationMethod,
    default: LandedCostAllocationMethod.VALUE
  })
  allocationMethod: LandedCostAllocationMethod;

  @Column({ name: 'gl_account_id', type: 'uuid', nullable: true })
  glAccountId: string;

  @Column({ default: true })
  isActive: boolean;
}
