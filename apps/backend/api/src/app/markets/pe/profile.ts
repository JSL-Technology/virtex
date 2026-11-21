// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * INEI departamentos. The first two digits of the six-digit ubigeo SUNAT requires on the
 * electronic receipt, collected separately so the two cannot disagree.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['01', 'Amazonas'],
  ['02', 'Áncash'],
  ['03', 'Apurímac'],
  ['04', 'Arequipa'],
  ['05', 'Ayacucho'],
  ['06', 'Cajamarca'],
  ['07', 'Callao'],
  ['08', 'Cusco'],
  ['09', 'Huancavelica'],
  ['10', 'Huánuco'],
  ['11', 'Ica'],
  ['12', 'Junín'],
  ['13', 'La Libertad'],
  ['14', 'Lambayeque'],
  ['15', 'Lima'],
  ['16', 'Loreto'],
  ['17', 'Madre de Dios'],
  ['18', 'Moquegua'],
  ['19', 'Pasco'],
  ['20', 'Piura'],
  ['21', 'Puno'],
  ['22', 'San Martín'],
  ['23', 'Tacna'],
  ['24', 'Tumbes'],
  ['25', 'Ucayali'],
].map(([code, name]) => ({ code, name }));

/** Peru: who the market is. */
export const profile: MarketProfile = {
  name: 'Perú',
  currency: 'PEN',
  locale: 'es-PE',
  booksLanguage: 'es',
  timeZone: 'America/Lima',
  callingCode: '51',
  fiscalAuthority: 'SUNAT',
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
  examples: { city: 'Lima', postalCode: '15001', phone: '01 555 0123' },
  marketStatus: 'available',
};
