
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { DatasheetBook } from './datasheet-book.entity';

@Entity('datasheet_sheets')
export class DatasheetSheet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  index: number;

  @Column({ default: false })
  protected: boolean;

  @Column({ type: 'jsonb', default: {} })
  cells: Record<string, any>;

  @Column({ type: 'jsonb', default: [] })
  conditionalFormats: any[];

  @Column({ type: 'jsonb', default: [] })
  charts: any[];

  @Column({ type: 'jsonb', default: [] })
  namedRanges: any[];

  @ManyToOne(() => DatasheetBook, (book) => book.sheets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bookId' })
  book: DatasheetBook;

  @Column()
  bookId: string;
}
