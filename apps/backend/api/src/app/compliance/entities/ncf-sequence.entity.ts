
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

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

@Entity({ name: 'ncf_sequences' })
@Index(['organizationId', 'type', 'isActive'], { where: `"is_active" = true` })
export class NcfSequence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

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
   */
  @Column({ name: 'expires_at', type: 'date', nullable: true })
  expiresAt?: string | null;
}