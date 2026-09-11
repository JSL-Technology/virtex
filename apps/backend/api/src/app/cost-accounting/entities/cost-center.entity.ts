
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export enum CostCenterType {
  COST_CENTER = 'COST_CENTER',
  PROFIT_CENTER = 'PROFIT_CENTER',
}

@Entity({ name: 'cost_centers' })
// A cost-centre code is unique WITHIN a tenant, not globally. The column carried a bare
// `unique: true`, so the first organization to use code `CC-01` reserved it for the whole
// database and every other tenant was refused. Uniqueness is per organization.
@Index('IDX_cost_centers_org_code', ['organizationId', 'code'], { unique: true })
export class CostCenter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  organizationId: string;

  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: CostCenterType })
  type: CostCenterType;
}