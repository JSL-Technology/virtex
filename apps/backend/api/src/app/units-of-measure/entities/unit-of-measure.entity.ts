
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class UnitOfMeasure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  symbol: string;

  @Column()
  category: string;

  @Column({ unique: true })
  nameKey: string;
}