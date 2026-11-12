// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * Hacienda provincias — the first digit of the location code the electronic invoice carries.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['1', 'San José'],
  ['2', 'Alajuela'],
  ['3', 'Cartago'],
  ['4', 'Heredia'],
  ['5', 'Guanacaste'],
  ['6', 'Puntarenas'],
  ['7', 'Limón'],
].map(([code, name]) => ({ code, name }));

/** Costa Rica: who the market is. */
export const profile: MarketProfile = {
  name: 'Costa Rica',
  currency: 'CRC',
  locale: 'es-CR',
  booksLanguage: 'es',
  timeZone: 'America/Costa_Rica',
  callingCode: '506',
  fiscalAuthority: 'Ministerio de Hacienda',
  address: {
    divisionLabel: 'Provincia',
    divisionLabelKey: 'fiscal.labels.province',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{5}$',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',' },
  examples: { city: 'San José', postalCode: '10101', phone: '2255 0123' },
  marketStatus: 'preview',
};
