
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { DatasheetBook } from './datasheet-book.entity';
import { User } from '../../users/entities/user.entity/user.entity';
import { Role } from '../../roles/entities/role.entity';

export enum DatasheetAccessRole {
  OWNER = 'owner',
  EDITOR = 'editor',
  COMMENTER = 'commenter',
  READER = 'reader'
}

@Entity('datasheet_permissions')
export class DatasheetPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DatasheetBook, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bookId' })
  book: DatasheetBook;

  @Column()
  bookId: string;

  @Column({
    type: 'enum',
    enum: DatasheetAccessRole
  })
  role: DatasheetAccessRole;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => Role, { nullable: true })
  @JoinColumn({ name: 'roleId' })
  systemRole: Role;

  @Column({ nullable: true })
  roleId: string;

  @Column({ default: false })
  isPublic: boolean;
}
