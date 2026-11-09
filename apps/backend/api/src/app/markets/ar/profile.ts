// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * AFIP/INDEC provincias. The code is the one AFIP publishes for the issuer's address on an
 * electronic invoice.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['00', 'Ciudad Autónoma de Buenos Aires'],
  ['01', 'Buenos Aires'],
  ['02', 'Catamarca'],
  ['03', 'Córdoba'],
  ['04', 'Corrientes'],
  ['05', 'Entre Ríos'],
  ['06', 'Jujuy'],
  ['07', 'Mendoza'],
  ['08', 'La Rioja'],
  ['09', 'Salta'],
  ['10', 'San Juan'],
  ['11', 'San Luis'],
  ['12', 'Santa Fe'],
  ['13', 'Santiago del Estero'],
  ['14', 'Tucumán'],
  ['16', 'Chaco'],
  ['17', 'Chubut'],
  ['18', 'Formosa'],
  ['19', 'Misiones'],
  ['20', 'Neuquén'],
  ['21', 'La Pampa'],
  ['22', 'Río Negro'],
  ['23', 'Santa Cruz'],
  ['24', 'Tierra del Fuego'],
].map(([code, name]) => ({ code, name }));

/** Argentina: who the market is. */
export const profile: MarketProfile = {
  name: 'Argentina',
  currency: 'ARS',
  locale: 'es-AR',
  booksLanguage: 'es',
  timeZone: 'America/Argentina/Buenos_Aires',
  callingCode: '54',
  fiscalAuthority: 'AFIP',
  address: {
    divisionLabel: 'Provincia',
    divisionLabelKey: 'fiscal.labels.province',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^[A-Z]?\\d{4}[A-Z]{0,3}$',
    postalCodeRequired: true,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',' },
  examples: { city: 'Buenos Aires', postalCode: 'C1002AAA', phone: '011 5555-0123' },
  marketStatus: 'available',
};
