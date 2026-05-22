
import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('employees')
export class Employee extends BaseEntity {
  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'job_title', nullable: true })
  jobTitle: string;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string;

  @Column({ name: 'hire_date', type: 'date', nullable: true })
  hireDate: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string;
}
