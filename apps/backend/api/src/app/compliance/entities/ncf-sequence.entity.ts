import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Organization } from '../../organizations/entities/organization.entity';

export enum NcfType {
  // Legacy pre-printed NCF (comprobantes fiscales físicos) — still valid for contingency.
  B01 = 'B01',
  B02 = 'B02',
  B03 = 'B03',
  B04 = 'B04',
  B11 = 'B11',
  B15 = 'B15',
  // Electronic fiscal receipts (e-CF / e-NCF). The two trailing digits are the DGII document type.
  E31 = 'E31', // Factura de Crédito Fiscal Electrónica
  E32 = 'E32', // Factura de Consumo Electrónica
  E33 = 'E33', // Nota de Débito Electrónica
  E34 = 'E34', // Nota de Crédito Electrónica
  E41 = 'E41', // Compras Electrónico
  E43 = 'E43', // Gastos Menores Electrónico
  E44 = 'E44', // Regímenes Especiales Electrónico
  E45 = 'E45', // Gubernamental Electrónico
  E46 = 'E46', // Exportaciones Electrónico
  E47 = 'E47', // Pagos al Exterior Electrónico
}

/** True for the electronic (e-CF) document types that must be signed and transmitted to the DGII. */
export function isElectronicNcfType(type: NcfType): boolean {
  return type.startsWith('E');
}

/** The DGII document-type code carried by a fiscal number (`E31` → `31`). */
export function dgiiDocumentCode(type: NcfType): string {
  return type.substring(1);
}

/**
 * Types that record a SALE, and are therefore issuable from the invoicing module. `E41` (purchases),
 * `E43` (minor expenses) and `E47` (payments abroad) are self-issued against a supplier and belong
 * to Accounts Payable; offering them on a sales document would produce a comprobante the DGII
 * rejects.
 */
export const SALES_NCF_TYPES: readonly NcfType[] = Object.freeze([
  NcfType.B01,
  NcfType.B02,
  NcfType.B04,
  NcfType.B11,
  NcfType.B15,
  NcfType.E31,
  NcfType.E32,
  NcfType.E34,
  NcfType.E44,
  NcfType.E45,
  NcfType.E46,
]);

/** Types that credit a previously issued sales document. */
export const CREDIT_NOTE_NCF_TYPES: readonly NcfType[] = Object.freeze([NcfType.E34, NcfType.B04]);

@Entity({ name: 'ncf_sequences' })
// One active range per type per tenant, enforced by the database. Without this, two active ranges
// of the same type could coexist and `getNextNcf` picked one non-deterministically — the same
// number could be handed out twice.
@Index('UQ_ncf_sequences_active_type', ['organizationId', 'type'], {
  unique: true,
  where: `"is_active" = true`,
})
export class NcfSequence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * `uuid`, matching `organizations.id`, with a foreign key.
   *
   * Twenty tables held the tenant reference as `character varying` while the column it points at
   * is a uuid. A join between them was a type error PostgreSQL refused outright, and a row whose
   * organization had been deleted was perfectly storable.
   */
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'enum', enum: NcfType })
  type: NcfType;

  @Column()
  prefix: string;

  @Column({ name: 'starts_at', type: 'bigint' })
  startsAt: number;

  @Column({ name: 'ends_at', type: 'bigint' })
  endsAt: number;

  @Column({ name: 'current_sequence', type: 'bigint' })
  currentSequence: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /**
   * Expiration date of the DGII authorization for this range (e-NCF authorizations are time-boxed).
   * Null for legacy pre-printed ranges that carry no expiry. When set and in the past, the range is
   * no longer usable regardless of remaining numbers.
   *
   * It is also `FechaVencimientoSecuencia`, a mandatory element of every e-CF: the column existed
   * and was validated on issuance, but nothing could ever set it — neither the DTO nor the screen
   * asked for it — so the check was unreachable and the XML shipped without the element.
   */
  @Column({ name: 'expires_at', type: 'date', nullable: true })
  expiresAt?: string | null;

  /** Authorization reference the DGII issued for this range, for audit and support. */
  @Column({ name: 'authorization_code', type: 'varchar', length: 64, nullable: true })
  authorizationCode?: string | null;

  /** Numbers left before the range is exhausted. */
  get remaining(): number {
    return Math.max(0, Number(this.endsAt) - Number(this.currentSequence));
  }
}
