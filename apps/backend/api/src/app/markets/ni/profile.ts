// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * DGI/INIDE departamentos and the two autonomous Caribbean regions.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['05', 'Boaco'],
  ['10', 'Carazo'],
  ['20', 'Chinandega'],
  ['25', 'Chontales'],
  ['30', 'Estelí'],
  ['35', 'Granada'],
  ['40', 'Jinotega'],
  ['45', 'León'],
  ['50', 'Madriz'],
  ['55', 'Managua'],
  ['60', 'Masaya'],
  ['65', 'Matagalpa'],
  ['70', 'Nueva Segovia'],
  ['75', 'Río San Juan'],
  ['80', 'Rivas'],
  ['85', 'Costa Caribe Norte'],
  ['90', 'Costa Caribe Sur'],
].map(([code, name]) => ({ code, name }));

/** Nicaragua: who the market is. */
export const profile: MarketProfile = {
  name: 'Nicaragua',
  currency: 'NIO',
  locale: 'es-NI',
  booksLanguage: 'es',
  timeZone: 'America/Managua',
  callingCode: '505',
  fiscalAuthority: 'DGI',
  address: {
    divisionLabel: 'Departamento',
    divisionLabelKey: 'fiscal.labels.department',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.' },
  examples: { city: 'Managua', postalCode: '10000', phone: '2255 0123' },
  marketStatus: 'preview',
};
