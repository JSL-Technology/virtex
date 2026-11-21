// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * SET/DGEEC departamentos, with Asunción as the capital district.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['00', 'Asunción'],
  ['01', 'Concepción'],
  ['02', 'San Pedro'],
  ['03', 'Cordillera'],
  ['04', 'Guairá'],
  ['05', 'Caaguazú'],
  ['06', 'Caazapá'],
  ['07', 'Itapúa'],
  ['08', 'Misiones'],
  ['09', 'Paraguarí'],
  ['10', 'Alto Paraná'],
  ['11', 'Central'],
  ['12', 'Ñeembucú'],
  ['13', 'Amambay'],
  ['14', 'Canindeyú'],
  ['15', 'Presidente Hayes'],
  ['16', 'Alto Paraguay'],
  ['17', 'Boquerón'],
].map(([code, name]) => ({ code, name }));

/** Paraguay: who the market is. */
export const profile: MarketProfile = {
  name: 'Paraguay',
  currency: 'PYG',
  locale: 'es-PY',
  booksLanguage: 'es',
  timeZone: 'America/Asuncion',
  callingCode: '595',
  fiscalAuthority: 'SET',
  address: {
    divisionLabel: 'Departamento',
    divisionLabelKey: 'fiscal.labels.department',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{4}$',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',' },
  examples: { city: 'Asunción', postalCode: '1209', phone: '021 555 012' },
  marketStatus: 'preview',
};
