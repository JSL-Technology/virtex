import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { encryptedColumnTransformer } from '../../common/database/encrypted-column.transformer';
import { Supplier } from './supplier.entity';

export enum SupplierBankAccountType {
  CHECKING = 'CHECKING',
  SAVINGS = 'SAVINGS',
}

/**
 * Where a supplier is paid (audit 2026-11-07, CMP-17). Without it no electronic payment could be
 * prepared. The number is encrypted at rest and never returned whole: `accountLast4` is what a
 * screen shows. Changing where a supplier is paid re-authenticates (step-up), because redirecting
 * a supplier's payments is the classic payment fraud.
 */
@Entity({ name: 'supplier_bank_accounts' })
@Index('IDX_supplier_bank_accounts_supplier', ['organizationId', 'supplierId'])
@Index('UQ_supplier_bank_accounts_default', ['supplierId'], { unique: true, where: '"is_default"' })
@Check('CHK_supplier_bank_accounts_type', `"account_type" IN ('CHECKING', 'SAVINGS')`)
export class SupplierBankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  // By name: the entity is the organizations module's (verify:boundaries).
  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_supplier_bank_accounts_organization' })
  organization?: unknown;

  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @ManyToOne(() => Supplier, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supplier_id', foreignKeyConstraintName: 'FK_supplier_bank_accounts_supplier' })
  supplier?: Supplier;

  @Column({ name: 'bank_name', type: 'varchar', length: 120 })
  bankName: string;

  @Column({ name: 'account_holder', type: 'varchar', length: 160, nullable: true })
  accountHolder: string | null;

  @Column({ name: 'account_type', type: 'varchar', length: 10, default: SupplierBankAccountType.CHECKING })
  accountType: SupplierBankAccountType;

  /** Encrypted at rest; not selected unless a payment needs it. */
  @Column({ name: 'account_number', type: 'text', select: false, transformer: encryptedColumnTransformer })
  accountNumber: string;

  @Column({ name: 'account_last4', type: 'varchar', length: 4 })
  accountLast4: string;

  @Column({ name: 'currency_code', type: 'varchar', length: 3, nullable: true })
  currencyCode: string | null;

  @Column({ type: 'varchar', length: 11, nullable: true })
  swift: string | null;

  @Column({ type: 'varchar', length: 34, nullable: true })
  iban: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
