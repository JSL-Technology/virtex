import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class CostCenter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;
}