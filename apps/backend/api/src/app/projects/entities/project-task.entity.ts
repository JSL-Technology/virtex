
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Project } from './project.entity';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';

@Entity('project_tasks')
export class ProjectTask extends BaseEntity {
  @ManyToOne(() => Project, { onDelete: 'NO ACTION', deferrable: 'INITIALLY DEFERRED' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column()
  name: string;

  @Column({ name: 'assigned_to_user_id', type: 'uuid', nullable: true })
  assignedToUserId: string;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate: Date;

  @Column({ type: 'int', default: 0 })
  percentComplete: number;

  // Tenant-owned: deleting the tenant deletes this row (see TenantOwned).
  @TenantOwned('FK_project_tasks_organization')
  organization?: TenantRef;
}
