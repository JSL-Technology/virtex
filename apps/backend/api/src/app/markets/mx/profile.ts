// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

const DIVISIONS: readonly AdministrativeDivision[] = [
  { code: 'AGU', name: 'Aguascalientes' }, { code: 'BCN', name: 'Baja California' },
  { code: 'BCS', name: 'Baja California Sur' }, { code: 'CAM', name: 'Campeche' },
  { code: 'CHP', name: 'Chiapas' }, { code: 'CHH', name: 'Chihuahua' },
  { code: 'CMX', name: 'Ciudad de México' }, { code: 'COA', name: 'Coahuila' },
  { code: 'COL', name: 'Colima' }, { code: 'DUR', name: 'Durango' },
  { code: 'GUA', name: 'Guanajuato' }, { code: 'GRO', name: 'Guerrero' },
  { code: 'HID', name: 'Hidalgo' }, { code: 'JAL', name: 'Jalisco' },
  { code: 'MEX', name: 'México' }, { code: 'MIC', name: 'Michoacán' },
  { code: 'MOR', name: 'Morelos' }, { code: 'NAY', name: 'Nayarit' },
  { code: 'NLE', name: 'Nuevo León' }, { code: 'OAX', name: 'Oaxaca' },
  { code: 'PUE', name: 'Puebla' }, { code: 'QUE', name: 'Querétaro' },
  { code: 'ROO', name: 'Quintana Roo' }, { code: 'SLP', name: 'San Luis Potosí' },
  { code: 'SIN', name: 'Sinaloa' }, { code: 'SON', name: 'Sonora' },
  { code: 'TAB', name: 'Tabasco' }, { code: 'TAM', name: 'Tamaulipas' },
  { code: 'TLA', name: 'Tlaxcala' }, { code: 'VER', name: 'Veracruz' },
  { code: 'YUC', name: 'Yucatán' }, { code: 'ZAC', name: 'Zacatecas' },
];

/** Mexico: who the market is. */
export const profile: MarketProfile = {
  name: 'México',
  currency: 'MXN',
  locale: 'es-MX',
  booksLanguage: 'es',
  timeZone: 'America/Mexico_City',
  callingCode: '52',
  fiscalAuthority: 'SAT',
  address: {
    divisionLabel: 'Estado',
    divisionLabelKey: 'fiscal.labels.state',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{5}$',
    postalCodeRequired: true,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.' },
  examples: { city: 'Monterrey', postalCode: '64000', phone: '81 5555 0123' },
  marketStatus: 'available',
};
