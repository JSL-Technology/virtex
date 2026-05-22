
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity({ name: 'inflation_indices' })
@Index(['organizationId', 'year', 'month'], { unique: true })
export class InflationIndex {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column()
  year: number;

  @Column()
  month: number;

  @Column('decimal', { precision: 10, scale: 6 })
  rate: number;

  @Column({ type: 'text', nullable: true })
  source?: string;
}
