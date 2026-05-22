import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class ExchangeRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  fromCurrency: string;

  @Column()
  toCurrency: string;

  @Column('decimal', { precision: 10, scale: 6 })
  rate: number;

  @Column()
  date: Date;
}