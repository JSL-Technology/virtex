import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'dim_time' })
export class TimeDimension {
  @PrimaryColumn({ type: 'date' })
  date: string;

  @Column()
  year: number;

  @Column()
  quarter: number;

  @Column()
  month: number;

  @Column({ name: 'month_name' })
  monthName: string;

  @Column()
  week: number;

  @Column()
  day: number;

  @Column({ name: 'day_of_week' })
  dayOfWeek: number;

  @Column({ name: 'day_name' })
  dayName: string;
}
