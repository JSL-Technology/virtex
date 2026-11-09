// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * Ministerio de Hacienda departamentos — the code the DTE carries.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['01', 'Ahuachapán'],
  ['02', 'Santa Ana'],
  ['03', 'Sonsonate'],
  ['04', 'Chalatenango'],
  ['05', 'La Libertad'],
  ['06', 'San Salvador'],
  ['07', 'Cuscatlán'],
  ['08', 'La Paz'],
  ['09', 'Cabañas'],
  ['10', 'San Vicente'],
  ['11', 'Usulután'],
  ['12', 'San Miguel'],
  ['13', 'Morazán'],
  ['14', 'La Unión'],
].map(([code, name]) => ({ code, name }));

/** El Salvador: who the market is. */
export const profile: MarketProfile = {
  name: 'El Salvador',
  currency: 'USD',
  locale: 'es-SV',
  booksLanguage: 'es',
  timeZone: 'America/El_Salvador',
  callingCode: '503',
  fiscalAuthority: 'Ministerio de Hacienda',
  address: {
    divisionLabel: 'Departamento',
    divisionLabelKey: 'fiscal.labels.department',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.' },
  examples: { city: 'San Salvador', postalCode: null, phone: '2255 0123' },
  marketStatus: 'preview',
};
