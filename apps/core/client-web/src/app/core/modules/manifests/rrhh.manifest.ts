import { ModuleManifest, WindowKind } from '../module-manifest';

/**
 * People and payroll.
 *
 * ## Why this module exists now
 *
 * It did not, and everything behind it did. Thirty-six endpoints — the employee register with its
 * encrypted fiscal identity, the versioned pay history, the departments, the payroll run lifecycle,
 * the variable inputs, the payslips, the concept catalogue, the statutory parameter tables and the
 * three TSS filings — had been live since the payroll module shipped, reachable only with a REST
 * client. The product's only HR screen was a placeholder that read "Employee records, payroll, and
 * performance management" over an empty page, in English whatever language the reader had chosen,
 * and it was parked in the hidden `roadmap` module so it did not even appear in the menu.
 *
 * ## The shape of the module
 *
 * *Documents* are the things that happen: payroll runs. *Masters* are the things that persist:
 * people, departments, the concept catalogue and the statutory rates. `My payslips` sits in the
 * inbox group because it is the one screen here an ordinary employee opens, guarded by
 * `payroll:view_own` rather than by the permission that opens everybody's pay.
 */
export const RRHH_MODULE: ModuleManifest = {
  id: 'rrhh',
  titleKey: 'modules.hr',
  icon: 'UsersRound',
  basePath: '',
  order: 7,
  routes: [
    {
      path: 'payroll/my-payslips',
      kind: WindowKind.LIST,
      // Deliberately the narrow permission: this is what lets a person see their own pay without
      // seeing anybody else's.
      permission: 'payroll:view_own',
      titleKey: 'page_titles.my_payslips',
      icon: 'FileText',
      entityKeyFn: () => 'rrhh:my-payslips',
      menu: { group: 'inbox', labelKey: 'sidebar.hr.my_payslips' },
      load: () => import('../../../features/payroll/my-payslips/my-payslips.page').then((m) => m.MyPayslipsPage),
    },
    {
      path: 'payroll/runs',
      kind: WindowKind.LIST,
      permission: 'payroll:view',
      titleKey: 'page_titles.payroll_runs',
      icon: 'CalendarClock',
      entityKeyFn: () => 'rrhh:payroll-runs',
      menu: { group: 'documents', labelKey: 'sidebar.hr.payroll_runs' },
      load: () => import('../../../features/payroll/runs/runs.page').then((m) => m.PayrollRunsPage),
    },
    {
      path: 'payroll/runs/:id',
      kind: WindowKind.DOCUMENT,
      permission: 'payroll:view',
      titleKey: 'page_titles.payroll_run',
      icon: 'CalendarClock',
      entityKeyFn: (p) => `rrhh:payroll-run:${p['id']}`,
      load: () => import('../../../features/payroll/runs/detail/detail.page').then((m) => m.PayrollRunDetailPage),
    },
    {
      path: 'hcm/employees',
      kind: WindowKind.LIST,
      permission: 'hcm:view',
      titleKey: 'page_titles.employees',
      icon: 'UsersRound',
      entityKeyFn: () => 'rrhh:employees',
      menu: { group: 'masters', labelKey: 'sidebar.hr.employees' },
      load: () => import('../../../features/hcm/employees/employees.page').then((m) => m.EmployeesPage),
    },
    {
      path: 'hcm/employees/new',
      kind: WindowKind.DRAFT,
      permission: 'hcm:manage',
      titleKey: 'page_titles.employee_new',
      icon: 'UserPlus',
      entityKeyFn: () => 'rrhh:employee:new',
      load: () => import('../../../features/hcm/employees/form/form.page').then((m) => m.EmployeeFormPage),
    },
    {
      path: 'hcm/employees/:id/edit',
      kind: WindowKind.DRAFT,
      permission: 'hcm:view',
      titleKey: 'page_titles.employee_edit',
      icon: 'UsersRound',
      entityKeyFn: (p) => `rrhh:employee:${p['id']}`,
      load: () => import('../../../features/hcm/employees/form/form.page').then((m) => m.EmployeeFormPage),
    },
    {
      path: 'hcm/departments',
      kind: WindowKind.LIST,
      permission: 'hcm:view',
      titleKey: 'page_titles.departments',
      icon: 'Network',
      entityKeyFn: () => 'rrhh:departments',
      menu: { group: 'masters', labelKey: 'sidebar.hr.departments' },
      load: () => import('../../../features/hcm/departments/departments.page').then((m) => m.DepartmentsPage),
    },
    {
      path: 'payroll/concepts',
      kind: WindowKind.LIST,
      permission: 'payroll:view',
      titleKey: 'page_titles.payroll_concepts',
      icon: 'ListChecks',
      entityKeyFn: () => 'rrhh:payroll-concepts',
      menu: { group: 'masters', labelKey: 'sidebar.hr.payroll_concepts' },
      load: () => import('../../../features/payroll/concepts/concepts.page').then((m) => m.PayrollConceptsPage),
    },
    {
      path: 'payroll/parameters',
      kind: WindowKind.OVERVIEW,
      permission: 'payroll:view',
      titleKey: 'page_titles.payroll_parameters',
      icon: 'Percent',
      entityKeyFn: () => 'rrhh:payroll-parameters',
      menu: { group: 'masters', labelKey: 'sidebar.hr.payroll_parameters' },
      load: () => import('../../../features/payroll/parameters/parameters.page').then((m) => m.PayrollParametersPage),
    },
  ],
};
