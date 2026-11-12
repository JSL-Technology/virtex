// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * SAR/INE departamentos.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['01', 'Atlántida'],
  ['02', 'Colón'],
  ['03', 'Comayagua'],
  ['04', 'Copán'],
  ['05', 'Cortés'],
  ['06', 'Choluteca'],
  ['07', 'El Paraíso'],
  ['08', 'Francisco Morazán'],
  ['09', 'Gracias a Dios'],
  ['10', 'Intibucá'],
  ['11', 'Islas de la Bahía'],
  ['12', 'La Paz'],
  ['13', 'Lempira'],
  ['14', 'Ocotepeque'],
  ['15', 'Olancho'],
  ['16', 'Santa Bárbara'],
  ['17', 'Valle'],
  ['18', 'Yoro'],
].map(([code, name]) => ({ code, name }));

/** Honduras: who the market is. */
export const profile: MarketProfile = {
  name: 'Honduras',
  currency: 'HNL',
  locale: 'es-HN',
  booksLanguage: 'es',
  timeZone: 'America/Tegucigalpa',
  callingCode: '504',
  fiscalAuthority: 'SAR',
  address: {
    divisionLabel: 'Departamento',
    divisionLabelKey: 'fiscal.labels.department',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.' },
  examples: { city: 'Tegucigalpa', postalCode: '11101', phone: '2255 0123' },
  marketStatus: 'preview',
};
