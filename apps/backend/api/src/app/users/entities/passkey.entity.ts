import { Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { User } from './user.entity/user.entity';

@Entity('passkeys')
export class Passkey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  credentialID: string;

  @Column({ type: 'text' })
  publicKey: string;

  @Column({ type: 'int' })
  counter: number;

  @Column({ type: 'simple-array', nullable: true })
  transports: string[];

  @ManyToOne(() => User, (user) => user.passkeys, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  webAuthnUserID: string; // The user handle returned by the authenticator

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
