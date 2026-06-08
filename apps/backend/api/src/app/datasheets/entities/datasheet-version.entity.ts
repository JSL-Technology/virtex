
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { DatasheetBook } from './datasheet-book.entity';
import { User } from '../../users/entities/user.entity/user.entity';

@Entity('datasheet_versions')
export class DatasheetVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  versionNumber: number;

  @Column({ nullable: true })
  comment: string;

  @Column({ type: 'jsonb' })
  state: any;

  @ManyToOne(() => DatasheetBook, (book) => book.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bookId' })
  book: DatasheetBook;

  @Column()
  bookId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column()
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;
}
