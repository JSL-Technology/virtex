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
  'ACCOUNTING.PERIOD_CLOSED': {
    labelKey: 'REMEDY.OPEN_PERIOD',
    route: '/accounting/periods',
  },
  'ACCOUNTING.MODULE_PERIOD_CLOSED': {
    labelKey: 'REMEDY.OPEN_PERIOD',
    route: '/accounting/periods',
  },
  'COMPLIANCE.SECUENCIA_NCF_NO_ENCONTRADA': {
    labelKey: 'REMEDY.CONFIGURE_SEQUENCES',
    route: '/overview#settings/fiscal',
  },
  'INVENTORY.STOCK_INSUFICIENTE_DISPONIBLES_SOLICITADAS': {
    labelKey: 'REMEDY.VIEW_STOCK',
    route: '/inventory/products',
  },
  // The SaaS layer raises its own codes rather than localized keys (`SaasErrorCode`), so the plan
  // limit is matched on the code it really carries.
  SAAS_LIMIT_REACHED: {
    labelKey: 'REMEDY.REVIEW_PLAN',
    route: '/overview#settings/billing',
  },
};
