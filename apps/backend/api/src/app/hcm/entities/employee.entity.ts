
import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('employees')
// An employee's e-mail is unique WITHIN the tenant. The bare `unique: true` made it global, so two
// companies could never employ the same person, and a consultant on two tenants' payrolls was
// impossible to represent.
@Index('IDX_employees_org_email', ['organizationId', 'email'], { unique: true })
export class Employee extends BaseEntity {
  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Column()
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
