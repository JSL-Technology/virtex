/** Operating EBITDA for the fiscal year to date: operating result + depreciation. */
export class EbitdaDto {
  ebitda: number;
  /** Operating revenue − cost of sales − operating expenses. */
  operatingIncome: number;
  /** Depreciation added back (accounts with the DEPRECIATION_EXPENSE role). */
  depreciation: number;
  /** The period the figure covers. */
  periodFrom: string;
  periodTo: string;
  date: Date;
}
