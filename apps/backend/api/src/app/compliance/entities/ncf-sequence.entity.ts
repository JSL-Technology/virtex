
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

export enum NcfType {
  B01 = 'B01',
  B02 = 'B02',
  B03 = 'B03',
  B04 = 'B04',
  B11 = 'B11',
  B15 = 'B15',
}

@Entity({ name: 'ncf_sequences' })
@Index(['organizationId', 'type', 'isActive'], { where: `"is_active" = true` })
export class NcfSequence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ type: 'enum', enum: NcfType })
  type: NcfType;

  @Column()
  prefix: string;

  @Column({ name: 'starts_at', type: 'bigint' })
  startsAt: number;

  @Column({ name: 'ends_at', type: 'bigint' })
  endsAt: number;

  @Column({ name: 'current_sequence', type: 'bigint' })
  currentSequence: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}