
import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('departments')
export class Department extends BaseEntity {
  @Column()
  name: string;

  @Column({ name: 'manager_id', type: 'uuid', nullable: true })
  managerId: string;

  @Column({ name: 'cost_center', nullable: true })
  costCenter: string;
}
