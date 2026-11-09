// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * SENIAT/INE estados, including the Capital District.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['01', 'Distrito Capital'],
  ['02', 'Amazonas'],
  ['03', 'Anzoátegui'],
  ['04', 'Apure'],
  ['05', 'Aragua'],
  ['06', 'Barinas'],
  ['07', 'Bolívar'],
  ['08', 'Carabobo'],
  ['09', 'Cojedes'],
  ['10', 'Delta Amacuro'],
  ['11', 'Falcón'],
  ['12', 'Guárico'],
  ['13', 'Lara'],
  ['14', 'Mérida'],
  ['15', 'Miranda'],
  ['16', 'Monagas'],
  ['17', 'Nueva Esparta'],
  ['18', 'Portuguesa'],
  ['19', 'Sucre'],
  ['20', 'Táchira'],
  ['21', 'Trujillo'],
  ['22', 'La Guaira'],
  ['23', 'Yaracuy'],
  ['24', 'Zulia'],
  ['25', 'Dependencias Federales'],
].map(([code, name]) => ({ code, name }));

/** Venezuela: who the market is. */
export const profile: MarketProfile = {
  name: 'Venezuela',
  currency: 'VES',
  locale: 'es-VE',
  booksLanguage: 'es',
  timeZone: 'America/Caracas',
  callingCode: '58',
  fiscalAuthority: 'SENIAT',
  address: {
    divisionLabel: 'Estado',
    divisionLabelKey: 'fiscal.labels.state',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{4}$',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',' },
  examples: { city: 'Caracas', postalCode: '1010', phone: '0212 555 0123' },
  marketStatus: 'preview',
};
