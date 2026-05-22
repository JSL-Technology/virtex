
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export enum CostCenterType {
  COST_CENTER = 'COST_CENTER',
  PROFIT_CENTER = 'PROFIT_CENTER',
}

@Entity({ name: 'cost_centers' })
export class CostCenter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  organizationId: string;

  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: CostCenterType })
  type: CostCenterType;
}