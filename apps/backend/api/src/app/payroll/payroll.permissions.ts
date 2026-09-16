export const PAYROLL_PERMISSIONS = {
  /** Read the employee register. The HCM module existed with no permission gating it at all. */
  HCM_VIEW: 'hcm:view',
  /** Create, edit and remove employees and departments. */
  HCM_MANAGE: 'hcm:manage',
  /**
   * See an employee's sensitive personal data (national id, bank account).
   *
   * Held apart from `HCM_VIEW` on purpose: the whole HR team may need the register — names, roles,
   * departments — while only payroll may see the cédula and the account wages are paid into.
   */
  HCM_VIEW_SENSITIVE: 'hcm:view_sensitive',

  /**
   * Payroll, split finely because the risk in each step is different.
   *
   * `VIEW` reads runs and payslips (every salary in the company), `VIEW_COMPENSATION` reads and
   * edits what each person is paid, `MANAGE` configures concepts and parameters, `PROCESS`
   * calculates a run, `APPROVE` posts it to the ledger (segregated from whoever calculated it), and
   * `PAY` releases the money through treasury. `VIEW_OWN` is the employee's grant: their own
   * payslip and nothing else.
   */
  PAYROLL_VIEW: 'payroll:view',
  PAYROLL_VIEW_OWN: 'payroll:view_own',
  PAYROLL_VIEW_COMPENSATION: 'payroll:view_compensation',
  /**
   * Write what a person is paid. Split from `VIEW_COMPENSATION` because setting a salary is a
   * high-impact act that must not ride along with the right to read compensation.
   */
  PAYROLL_EDIT_COMPENSATION: 'payroll:edit_compensation',
  /** Configure the tenant's payroll concepts (earnings, deductions, employer costs). */
  PAYROLL_MANAGE: 'payroll:manage',
  /**
   * Edit the versioned statutory parameters (AFP/SFS/ISR rates, caps, minimum contributory wage,
   * tax scale). These are shared reference data affecting every tenant.
   */
  PAYROLL_PARAMETERS_MANAGE: 'payroll:parameters_manage',
  PAYROLL_PROCESS: 'payroll:process',
  PAYROLL_APPROVE: 'payroll:approve',
  PAYROLL_PAY: 'payroll:pay',
  /** Generate and export the TSS files (Novedades, Autodeterminación, SUIR). */
  TSS_EXPORT: 'tss:export',
} as const;
