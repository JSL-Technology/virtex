
import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('work_centers')
export class WorkCenter extends BaseEntity {
  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'capacity_per_hour', type: 'decimal', precision: 10, scale: 2, default: 0 })
  capacityPerHour: number;

  @Column({ name: 'hourly_rate', type: 'decimal', precision: 10, scale: 2, default: 0 })
  hourlyRate: number;

  @Column({ default: true })
  isActive: boolean;
}
