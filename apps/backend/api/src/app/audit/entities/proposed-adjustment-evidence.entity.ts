
import { User } from '../users/entities/user.entity/user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ProposedAdjustment } from './proposed-adjustment.entity';

@Entity({ name: 'proposed_adjustment_evidence' })
export class ProposedAdjustmentEvidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ProposedAdjustment, (adjustment) => adjustment.evidence, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'proposed_adjustment_id' })
  proposedAdjustment: ProposedAdjustment;

  @Column({ name: 'proposed_adjustment_id' })
  proposedAdjustmentId: string;

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

  @ManyToOne(() => User, { nullable: false, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedByUser: User;

  @Column({ name: 'uploaded_by_user_id' })
  uploadedByUserId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}