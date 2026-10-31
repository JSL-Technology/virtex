import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Whether the till issues a fiscal document per sale.
 *
 * - `AUTO`: where the market requires one (the Dominican Republic), yes; elsewhere, no.
 * - `REQUIRED`: always — a company outside the DR that wants every till sale in its books.
 * - `OFF`: never. Refused for a Dominican company, where it would mean selling without comprobante.
 */
export enum PosFiscalMode {
  AUTO = 'AUTO',
  REQUIRED = 'REQUIRED',
  OFF = 'OFF',
}

/** The point of sale's configuration, one row per company. */
@Entity('pos_settings')
export class PosSettings {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'fiscal_mode', type: 'varchar', length: 16, default: PosFiscalMode.AUTO })
  fiscalMode: PosFiscalMode;

  /** Where cash takings land. Defaults to the company's CASH treasury account. */
  @Column({ name: 'cash_bank_account_id', type: 'uuid', nullable: true })
  cashBankAccountId: string | null;

  /** Where card takings land — the acquirer's settlement account. */
  @Column({ name: 'card_bank_account_id', type: 'uuid', nullable: true })
  cardBankAccountId: string | null;

  /** Where transfers (and other tenders) land. */
  @Column({ name: 'transfer_bank_account_id', type: 'uuid', nullable: true })
  transferBankAccountId: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
