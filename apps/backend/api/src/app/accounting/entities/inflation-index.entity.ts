
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { numericTransformerNotNull } from '../../common/database/numeric.transformer';

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

  @Column('decimal', { precision: 10, scale: 6, transformer: numericTransformerNotNull })
  rate: number;

  @Column({ type: 'text', nullable: true })
  source?: string;
}
