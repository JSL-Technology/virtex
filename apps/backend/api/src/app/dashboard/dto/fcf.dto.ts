export class FcfDto {
  /** Cash from operations and investment, year to date (see `DashboardService.getFreeCashFlow`). */
  freeCashFlow: number;
  /** First day of the period the figure covers, `YYYY-MM-DD`. */
  periodStart?: string;
  date: Date;
}
