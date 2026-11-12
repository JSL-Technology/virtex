// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * SAT/INE departamentos.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['01', 'Guatemala'],
  ['02', 'El Progreso'],
  ['03', 'Sacatepéquez'],
  ['04', 'Chimaltenango'],
  ['05', 'Escuintla'],
  ['06', 'Santa Rosa'],
  ['07', 'Sololá'],
  ['08', 'Totonicapán'],
  ['09', 'Quetzaltenango'],
  ['10', 'Suchitepéquez'],
  ['11', 'Retalhuleu'],
  ['12', 'San Marcos'],
  ['13', 'Huehuetenango'],
  ['14', 'Quiché'],
  ['15', 'Baja Verapaz'],
  ['16', 'Alta Verapaz'],
  ['17', 'Petén'],
  ['18', 'Izabal'],
  ['19', 'Zacapa'],
  ['20', 'Chiquimula'],
  ['21', 'Jalapa'],
  ['22', 'Jutiapa'],
].map(([code, name]) => ({ code, name }));

/** Guatemala: who the market is. */
export const profile: MarketProfile = {
  name: 'Guatemala',
  currency: 'GTQ',
  locale: 'es-GT',
  booksLanguage: 'es',
  timeZone: 'America/Guatemala',
  callingCode: '502',
  fiscalAuthority: 'SAT',
  address: {
    divisionLabel: 'Departamento',
    divisionLabelKey: 'fiscal.labels.department',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{5}$',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.' },
  examples: { city: 'Ciudad de Guatemala', postalCode: '01001', phone: '2255 0123' },
  marketStatus: 'preview',
};
