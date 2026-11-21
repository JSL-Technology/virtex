// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * INEC provincias. The first two digits of the SRI establishment code.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['01', 'Azuay'],
  ['02', 'Bolívar'],
  ['03', 'Cañar'],
  ['04', 'Carchi'],
  ['05', 'Cotopaxi'],
  ['06', 'Chimborazo'],
  ['07', 'El Oro'],
  ['08', 'Esmeraldas'],
  ['09', 'Guayas'],
  ['10', 'Imbabura'],
  ['11', 'Loja'],
  ['12', 'Los Ríos'],
  ['13', 'Manabí'],
  ['14', 'Morona Santiago'],
  ['15', 'Napo'],
  ['16', 'Pastaza'],
  ['17', 'Pichincha'],
  ['18', 'Tungurahua'],
  ['19', 'Zamora Chinchipe'],
  ['20', 'Galápagos'],
  ['21', 'Sucumbíos'],
  ['22', 'Orellana'],
  ['23', 'Santo Domingo de los Tsáchilas'],
  ['24', 'Santa Elena'],
].map(([code, name]) => ({ code, name }));

/** Ecuador: who the market is. */
export const profile: MarketProfile = {
  name: 'Ecuador',
  currency: 'USD',
  locale: 'es-EC',
  booksLanguage: 'es',
  timeZone: 'America/Guayaquil',
  callingCode: '593',
  fiscalAuthority: 'SRI',
  address: {
    divisionLabel: 'Provincia',
    divisionLabelKey: 'fiscal.labels.province',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{6}$',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.' },
  examples: { city: 'Quito', postalCode: '170150', phone: '02 255 0123' },
  marketStatus: 'available',
};
