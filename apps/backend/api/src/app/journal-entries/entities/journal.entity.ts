
import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

export type JournalType = 'SALES' | 'PURCHASES' | 'CASH' | 'BANK' | 'GENERAL';

@Entity({ name: 'journals' })
@Index(['organizationId', 'code'], { unique: true })
export class Journal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * `uuid`, matching `organizations.id`, with a foreign key.
   *
   * Twenty tables held the tenant reference as `character varying` while the column it points at
   * is a uuid. A join between them was a type error PostgreSQL refused outright, and a row whose
   * organization had been deleted was perfectly storable.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ length: 10 })
  code: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'varchar' })
  type: JournalType;
}