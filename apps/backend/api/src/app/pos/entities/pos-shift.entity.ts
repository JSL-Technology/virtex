import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  numericTransformer,
  numericTransformerNotNull,
} from '../../common/database/numeric.transformer';
import { Organization } from '../../organizations/entities/organization.entity';

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
@Index('IDX_pos_shifts_org_terminal_status', ['organizationId', 'terminalId', 'status'])
export class PosShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * `uuid`, and the index and the foreign key are named.
   *
   * The migration built this column as `uuid NOT NULL` with `FK_pos_shifts_organization` and
   * `IDX_pos_shifts_org`; the entity said `@Column()`, which reflect-metadata resolves to
   * `varchar` and TypeORM names indexes by hash. `check:schema-drift` therefore proposed dropping
   * and re-adding the column — losing every shift — and renaming both objects, on every run.
   */
  @Index('IDX_pos_shifts_org')
  @Column({ type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organizationId',
    foreignKeyConstraintName: 'FK_pos_shifts_organization',
  })
  organization: Organization;

  @Column({ length: 120 })
  terminalId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  openingBalance: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
    nullable: true,
  })
  closingBalance: number | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  salesTotal: number;

  @Column({ type: 'int', default: 0 })
  salesCount: number;

  @Column({ type: 'enum', enum: PosShiftStatus, default: PosShiftStatus.OPEN })
  status: PosShiftStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  openedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
