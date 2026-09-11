import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../common/database/numeric.transformer';

export enum PosShiftStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

/**
 * A till session on one terminal: who opened it, with how much float, and what it took.
 *
 * The consolidation of special-enigma's `PosShift` onto the platform's TypeORM + tenant model.
 * Tenant-scoped by `organizationId`; a terminal may have at most one OPEN shift at a time, which
 * the service enforces before a sale is allowed — a sale outside an open shift has nowhere to be
 * counted and no one accountable for the drawer.
 */
@Entity({ name: 'pos_shifts' })
@Index(['organizationId', 'terminalId', 'status'])
export class PosShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  organizationId: string;

  @Column({ length: 120 })
  terminalId: string;

  @Column()
  userId: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer, default: 0 })
  openingBalance: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
    nullable: true,
  })
  closingBalance: number | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer, default: 0 })
  salesTotal: number;

  @Column({ type: 'int', default: 0 })
  salesCount: number;

  @Column({ type: 'enum', enum: PosShiftStatus, default: PosShiftStatus.OPEN })
  status: PosShiftStatus;

  @CreateDateColumn()
  openedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
