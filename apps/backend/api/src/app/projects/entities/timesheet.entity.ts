
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Project } from './project.entity';
import { ProjectTask } from './project-task.entity';

@Entity('timesheets')
export class Timesheet extends BaseEntity {
  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => ProjectTask)
  @JoinColumn({ name: 'task_id' })
  task: ProjectTask;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  hours: number;

  @Column({ type: 'text', nullable: true })
  description: string;
}
