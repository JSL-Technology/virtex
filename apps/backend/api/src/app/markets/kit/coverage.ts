import type { CoverageLine } from '../contracts';

export const implemented = (detail?: string): CoverageLine => (detail === undefined ? { level: 'implemented' } : { level: 'implemented', detail });

export const notImplemented = (detail?: string): CoverageLine =>
  detail === undefined ? { level: 'not-implemented' } : { level: 'not-implemented', detail };

export const needsCredentials = (detail: string, requires: string): CoverageLine => ({ level: 'needs-credentials', detail, requires });

export const needsConfiguration = (detail: string, requires: string): CoverageLine => ({ level: 'needs-configuration', detail, requires });

/** Withholding the tenant configures: the regimes and rates that apply to it, entered in settings. */
export const TENANT_CONFIGURED_WITHHOLDING: CoverageLine = needsCredentials(
  'Regímenes configurables por el contribuyente',
  'los regímenes y tarifas que te apliquen, en Ajustes → Impuestos',
);
