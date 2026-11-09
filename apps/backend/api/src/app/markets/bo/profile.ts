// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * SIN/INE departamentos.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['01', 'Chuquisaca'],
  ['02', 'La Paz'],
  ['03', 'Cochabamba'],
  ['04', 'Oruro'],
  ['05', 'Potosí'],
  ['06', 'Tarija'],
  ['07', 'Santa Cruz'],
  ['08', 'Beni'],
  ['09', 'Pando'],
].map(([code, name]) => ({ code, name }));

/** Bolivia: who the market is. */
export const profile: MarketProfile = {
  name: 'Bolivia',
  currency: 'BOB',
  locale: 'es-BO',
  booksLanguage: 'es',
  timeZone: 'America/La_Paz',
  callingCode: '591',
  fiscalAuthority: 'SIN',
  address: {
    divisionLabel: 'Departamento',
    divisionLabelKey: 'fiscal.labels.department',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',' },
  examples: { city: 'La Paz', postalCode: null, phone: '2 255 0123' },
  marketStatus: 'preview',
};
