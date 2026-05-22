
import { Organization } from '../../organizations/entities/organization.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';

@Entity({ name: 'account_segment_definitions' })
@Index(['organizationId', 'order'], { unique: true })
export class AccountSegmentDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column()
  name: string;

  @Column({ type: 'int' })
  order: number;

  @Column({ type: 'int' })
  length: number;

  @Column({ default: true })
  isRequired: boolean;
}