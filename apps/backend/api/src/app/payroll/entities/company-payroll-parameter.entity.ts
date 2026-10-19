import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { numericTransformer } from '../../common/database/numeric.transformer';
import { TenantOwned, TenantRef } from '../../organizations/contracts/tenant-owned.contract';
import type { PayrollParameterKind } from '../../contracts/country-pack/country-pack';

/** One bracket of a withholding table, annual amounts. */
export interface WithholdingBracket {
  /** Annual wages over which the bracket starts. */
  over: number;
  /** Annual wages up to which it applies; null is the open top bracket. */
  upTo: number | null;
  /** Marginal rate within the bracket, as a fraction. */
  rate: number;
  /** Tax accumulated on the lower brackets. */
  baseAmount: number;
}

/** Where a figure came from: the market's published default, or the company itself. */
export type PayrollParameterSource = 'STATUTORY_DEFAULT' | 'COMPANY';

/**
 * A payroll parameter the COMPANY keeps: a rate, a table or an amount, in force from a date.
 *
 * ## Why a second parameter table
 *
 * The statutory tables beside this one (`payroll_statutory_contributions` and friends) are global
 * reference data for the markets whose rules the payroll engine computes — the Dominican TSS rates
 * are the same for every tenant, so the platform keeps them and no tenant may write them. That is
 * right for them and wrong for everyone else: the parameters page of a US company was empty, with no
 * way to add a single figure (QA C-06), because there was no table it was allowed to write.
 *
 * A US payroll needs figures of two kinds. The federal ones (FICA, Medicare, FUTA) are national and
 * published — they are seeded from the country pack as editable statutory defaults. The others are
 * the company's own: its state's withholding table, the unemployment rate its state assigned it.
 * Both live here, tenant-isolated, each row dated, so a company updates the Social Security wage
 * base in January by recording the new figure from its new date — the previous one keeps its own
 * window and a payroll recomputed for December still finds it.
 *
 * Columns are typed rather than a free key/value bag so a rate is always a fraction and a wage base
 * always an amount, which is what lets the screen render and validate them without guessing.
 */
@Entity('payroll_company_parameters')
@Index('IDX_payroll_company_parameters_lookup', ['organizationId', 'code', 'effectiveFrom'])
@Index('UQ_payroll_company_parameters_version', ['organizationId', 'code', 'jurisdiction', 'effectiveFrom'], { unique: true })
@Check('CHK_payroll_company_parameters_kind', `"kind" IN ('CONTRIBUTION','TABLE','AMOUNT')`)
@Check('CHK_payroll_company_parameters_window', `"effective_to" IS NULL OR "effective_to" >= "effective_from"`)
export class CompanyPayrollParameter extends BaseEntity {
  @TenantOwned('FK_payroll_company_parameters_organization')
  organization?: TenantRef;

  @Column({ name: 'country_code', length: 2 })
  countryCode: string;

  /** Stable identifier: `FICA_SOCIAL_SECURITY`, or one the company chose. */
  @Column({ length: 40 })
  code: string;

  @Column({ length: 160 })
  name: string;

  @Column({ name: 'kind', type: 'varchar', length: 16 })
  kind: PayrollParameterKind;

  /** The state or province the figure belongs to (`TX`); '' for a national one. */
  @Column({ name: 'jurisdiction', type: 'varchar', length: 8, default: '' })
  jurisdiction: string;

  @Column({ name: 'employee_rate', type: 'numeric', precision: 9, scale: 6, nullable: true, transformer: numericTransformer })
  employeeRate: number | null;

  @Column({ name: 'employer_rate', type: 'numeric', precision: 9, scale: 6, nullable: true, transformer: numericTransformer })
  employerRate: number | null;

  /** Annual wages the rate stops applying at. Null: uncapped. */
  @Column({ name: 'wage_base', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
  wageBase: number | null;

  /** Annual wages above which the rate starts applying. */
  @Column({ name: 'threshold', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
  threshold: number | null;

  /** Credit against the rate, as a fraction (FUTA's credit for state unemployment tax). */
  @Column({ name: 'credit_rate', type: 'numeric', precision: 9, scale: 6, nullable: true, transformer: numericTransformer })
  creditRate: number | null;

  @Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
  amount: number | null;

  /** For `TABLE` parameters: the brackets, annual. */
  @Column({ name: 'brackets', type: 'jsonb', nullable: true })
  brackets: WithholdingBracket[] | null;

  @Column({ name: 'currency_code', length: 3 })
  currencyCode: string;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  /** Null while current. Set when a newer figure supersedes this one. */
  @Column({ name: 'effective_to', type: 'date', nullable: true })
  effectiveTo: string | null;

  @Column({ name: 'source', type: 'varchar', length: 20, default: 'COMPANY' })
  source: PayrollParameterSource;

  /** The instrument that sets the figure (`IRC §3101(a)`), so checking it is a lookup. */
  @Column({ name: 'legal_basis', type: 'varchar', length: 200, nullable: true })
  legalBasis: string | null;

  /** Seeded without figures: the company has to enter them. */
  @Column({ name: 'requires_input', default: false })
  requiresInput: boolean;

  @Column({ name: 'active', default: true })
  active: boolean;
}
