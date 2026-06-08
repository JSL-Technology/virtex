
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn
} from 'typeorm';
import { User } from '../../users/entities/user.entity/user.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { DatasheetSheet } from './datasheet-sheet.entity';
import { DatasheetVersion } from './datasheet-version.entity';

export enum DatasheetMode {
  LIVE = 'live',
  SNAPSHOT = 'snapshot'
}

@Entity('datasheet_books')
export class DatasheetBook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: DatasheetMode,
    default: DatasheetMode.LIVE
  })
  mode: DatasheetMode;

  @Column({ type: 'jsonb', nullable: true })
  tags: string[];

  @ManyToOne(() => User)
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @Column()
  ownerId: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organizationId' })
  organization: Organization;

  @Column()
  organizationId: string;

  @OneToMany(() => DatasheetSheet, (sheet) => sheet.book, { cascade: true })
  sheets: DatasheetSheet[];

  @OneToMany(() => DatasheetVersion, (version) => version.book)
  versions: DatasheetVersion[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  modifiedAt: Date;
}
