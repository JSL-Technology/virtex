
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Project } from './project.entity';

@Entity('project_tasks')
export class ProjectTask extends BaseEntity {
  @ManyToOne(() => Project)
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
}
