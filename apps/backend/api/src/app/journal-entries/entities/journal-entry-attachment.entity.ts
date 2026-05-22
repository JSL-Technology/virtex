
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { JournalEntry } from './journal-entry.entity';
import { User } from '../../users/entities/user.entity/user.entity';

@Entity({ name: 'journal_entry_attachments' })
export class JournalEntryAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => JournalEntry, (entry) => entry.attachments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntry;

  @Column({ name: 'journal_entry_id' })
  journalEntryId: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'file_name' })
  fileName: string;

  @Column({ name: 'file_type' })
  fileType: string;

  @Column({ name: 'file_size' })
  fileSize: number;

  @Column({
    name: 'storage_key',
    comment: 'The key/path of the file in the storage service (e.g., S3 key)',
  })
  storageKey: string;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt: Date;


  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedBy: User;

  @Column({ name: 'uploaded_by_user_id' })
  uploadedByUserId: string;
}
