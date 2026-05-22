

import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Column } from 'typeorm';

import { Organization } from './organization.entity';

@Entity({ name: 'organization_subsidiaries' })
export class OrganizationSubsidiary {
  @PrimaryColumn({ name: 'parent_organization_id' })
  parentOrganizationId: string;

  @PrimaryColumn({ name: 'subsidiary_organization_id' })
  subsidiaryOrganizationId: string;

  @ManyToOne(() => Organization, org => org.subsidiaries, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_organization_id' })
  parent: Organization;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subsidiary_organization_id' })
  subsidiary: Organization;

  @Column({ type: 'decimal', precision: 5, scale: 2, comment: 'Porcentaje de propiedad' })
  ownership: number;
}