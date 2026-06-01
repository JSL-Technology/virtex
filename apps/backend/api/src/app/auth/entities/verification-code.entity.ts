
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity/user.entity';

export enum VerificationType {
  PHONE_VERIFY = 'PHONE_VERIFY',
  LOGIN_2FA = 'LOGIN_2FA',
  EMAIL_VERIFY = 'EMAIL_VERIFY',
}

@Entity({ name: 'verification_codes' })
export class VerificationCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', nullable: true })
  userId?: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ nullable: true })
  target?: string; // email or phone number for unauthenticated users

  @Column()
  code: string; // Hashed

  @Column({ nullable: true })
  payload?: string; // extra metadata

  @Column({
    type: 'enum',
    enum: VerificationType,
  })
  type: VerificationType;

  @Index()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
