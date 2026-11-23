/**
 * DGII e-CF service endpoints, resolved per environment.
 *
 * The DGII exposes three environments — TesteCF (pruebas), CerteCF (certificación) and Producción —
 * each a different host prefix over the same service paths. The DGII versions these paths in its
 * "Descripción Técnica y Funcional de e-CF"; every value here is therefore overridable through
 * configuration (see `DgiiConfigService`) so an operator can pin the exact paths its authorized
 * environment publishes without a code change. The defaults follow the DGII's published hosts.
 */
export type DgiiEnvironment = 'TesteCF' | 'CerteCF' | 'Produccion';

export interface DgiiEndpoints {
  environment: DgiiEnvironment;
  /** GET — obtains the authentication seed (semilla) XML to be signed. */
  seed: string;
  /** POST — exchanges the signed seed for a bearer token. */
  validateSeed: string;
  /** POST (multipart) — submits a signed e-CF for reception; returns a trackId. */
  reception: string;
  /**
   * POST (multipart) — the "Recepción de Factura de Consumo" service.
   *
   * Consumo comprobantes below the DGII's threshold are NOT sent to the ordinary reception service:
   * they go to this one, as a summary. Sending every document to `reception` — which is what the
   * transport did — means every E32 is rejected.
   */
  receptionConsumo: string;
  /** GET — polls the final DGII verdict for a trackId. */
  status: string;
  /** GET — lists trackIds for an e-NCF (reconciliation / idempotency checks). */
  trackIds: string;
  /** POST — submits/receives a commercial approval (aprobación comercial) response. */
  commercialApproval: string;
  /** POST — declares an authorized range as annulled (anulación de e-NCF). */
  voidRange: string;
  /** Public "consulta timbre" URL encoded in the QR of a fiscal-credit representación impresa. */
  timbre: string;
  /** Public "consulta timbre" URL for consumo documents (representación impresa de consumo). */
  timbreConsumo: string;
}

const HOSTS: Record<DgiiEnvironment, string> = {
  TesteCF: 'https://ecf.dgii.gov.do/testecf',
  CerteCF: 'https://ecf.dgii.gov.do/certecf',
  Produccion: 'https://ecf.dgii.gov.do/ecf',
};

const PATHS = {
  seed: '/autenticacion/api/Autenticacion/Semilla',
  validateSeed: '/autenticacion/api/Autenticacion/ValidarSemilla',
  reception: '/recepcion/api/FacturasElectronicas',
  receptionConsumo: '/recepcionfc/api/recepcion/ecf',
  status: '/consultaresultado/api/Consultas/Estado',
  trackIds: '/consultatrackids/api/TrackIds/Consulta',
  commercialApproval: '/aprobacioncomercial/api/RecepcionComercial',
  voidRange: '/anulacionrangos/api/Anulacion',
  timbre: '/ConsultaTimbre',
  timbreConsumo: '/ConsultaTimbreFC',
};

export function resolveDgiiEndpoints(
  environment: DgiiEnvironment,
  overrides: Partial<DgiiEndpoints> & { baseUrl?: string } = {},
): DgiiEndpoints {
  const base = (overrides.baseUrl ?? HOSTS[environment]).replace(/\/+$/, '');
  return {
    environment,
    seed: overrides.seed ?? `${base}${PATHS.seed}`,
    validateSeed: overrides.validateSeed ?? `${base}${PATHS.validateSeed}`,
    reception: overrides.reception ?? `${base}${PATHS.reception}`,
    receptionConsumo: overrides.receptionConsumo ?? `${base}${PATHS.receptionConsumo}`,
    status: overrides.status ?? `${base}${PATHS.status}`,
    trackIds: overrides.trackIds ?? `${base}${PATHS.trackIds}`,
    commercialApproval: overrides.commercialApproval ?? `${base}${PATHS.commercialApproval}`,
    voidRange: overrides.voidRange ?? `${base}${PATHS.voidRange}`,
    timbre: overrides.timbre ?? `${base}${PATHS.timbre}`,
    timbreConsumo: overrides.timbreConsumo ?? `${base}${PATHS.timbreConsumo}`,
  };
}
