import { Precondition } from './transition-preview';

/**
 * Where to go to fix a blocked transition.
 *
 * A failed precondition that does not say what to do about it is only a more detailed way of saying
 * no. Someone reading "period 2026-08 is closed" already knows they are blocked; what they need is
 * the screen that reopens it.
 *
 * ## Every key here is a code the product actually throws
 *
 * Keyed by the error's stable `code`. The first draft of this file invented three of its five keys
 * — `ACCOUNTING.PERIODO_CERRADO`, `INVOICES.NO_HAY_SECUENCIA_DISPONIBLE`,
 * `SAAS.LIMITE_PLAN_ALCANZADO` — which read plausibly and matched nothing. `messages.parity.spec.ts`
 * caught all three. A remedy attached to a code that is never raised is not merely useless: it is a
 * promise the interface silently fails to keep, and it looks like working code.
 *
 * The map is deliberately small. Only conditions with an unambiguous destination belong here;
 * "insufficient stock" has several possible answers — receive goods, transfer between warehouses,
 * change the line — and guessing one would be worse than offering none, so it points at the stock
 * screen rather than at a specific cure.
 */
export const REMEDIES: Record<string, Precondition['remedy']> = {
  'accounting.period_closed': {
    labelKey: 'remedy.open_period',
    route: '/accounting/periods',
  },
  'accounting.module_period_closed': {
    labelKey: 'remedy.open_period',
    route: '/accounting/periods',
  },
  'compliance.ncf_sequence_not_found': {
    labelKey: 'remedy.configure_sequences',
    route: '/overview#settings/fiscal',
  },
  // An electronic document needs a certificate to be signed and the company's RNC to be stated;
  // both are blocking conditions of the issue itself (`EcfSubmissionService.assertReadyToSign`).
  'einvoicing.do.no_active_digital_certificate_sign_cf': {
    labelKey: 'remedy.upload_certificate',
    route: '/overview#settings/fiscal',
  },
  'einvoicing.do.certificate_expired': {
    labelKey: 'remedy.upload_certificate',
    route: '/overview#settings/fiscal',
  },
  'einvoicing.do.organization_has_no_rnc_configured_fill': {
    labelKey: 'remedy.complete_company_profile',
    route: '/overview#settings/profile',
  },
  'inventory.not_enough_stock_name_available_available': {
    labelKey: 'remedy.view_stock',
    route: '/inventory/products',
  },
  // The SaaS layer raises its own codes rather than localized keys (`SaasErrorCode`), so the plan
  // limit is matched on the code it really carries.
  SAAS_LIMIT_REACHED: {
    labelKey: 'remedy.review_plan',
    route: '/overview#settings/billing',
  },
};
