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
import { BranchRef, IssuedAtBranch } from '../../organizations/contracts/branch.contract';

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
@Index('IDX_pos_shifts_org_branch', ['organizationId', 'branchId'])
@Entity({ name: 'pos_shifts' })
@Index('IDX_pos_shifts_org_terminal_status', ['organizationId', 'terminalId', 'status'])
// One open shift per terminal, enforced by the database (see PosServerAuthority1789007200000).
@Index('UQ_pos_shifts_open_terminal', ['organizationId', 'terminalId'], {
  unique: true,
  where: `"status" = 'OPEN'`,
})
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
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /** The branch this was issued from — see `IssuedAtBranch`. Null for a company without branches, and for documents that predate them. */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @IssuedAtBranch('FK_pos_shifts_branch')
  branch?: BranchRef | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'organization_id',
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

  /** Takings that went into the drawer: the part of `salesTotal` paid in cash. */
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformerNotNull, default: 0 })
  cashSalesTotal: number;

  /** What the drawer should hold at close: opening float plus cash takings. Set when it closes. */
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer, nullable: true })
  expectedBalance: number | null;

  /** Counted minus expected. Negative is a shortfall. Set when the shift closes. */
  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: numericTransformer, nullable: true })
  closingVariance: number | null;

  /** Who closed it — the cashier who opened it, or a supervisor holding `pos:manage_shifts`. */
  @Column({ type: 'uuid', nullable: true })
  closedById: string | null;

  @Column({ type: 'enum', enum: PosShiftStatus, default: PosShiftStatus.OPEN })
  status: PosShiftStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  openedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
