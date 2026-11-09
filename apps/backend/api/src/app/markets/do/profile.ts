// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

const DIVISIONS: readonly AdministrativeDivision[] = [
  ['01','Distrito Nacional'],['02','Azua'],['03','Baoruco'],['04','Barahona'],['05','Dajabón'],
  ['06','Duarte'],['07','Elías Piña'],['08','El Seibo'],['09','Espaillat'],['10','Independencia'],
  ['11','La Altagracia'],['12','La Romana'],['13','La Vega'],['14','María Trinidad Sánchez'],
  ['15','Monte Cristi'],['16','Pedernales'],['17','Peravia'],['18','Puerto Plata'],
  ['19','Hermanas Mirabal'],['20','Samaná'],['21','San Cristóbal'],['22','San Juan'],
  ['23','San Pedro de Macorís'],['24','Sánchez Ramírez'],['25','Santiago'],
  ['26','Santiago Rodríguez'],['27','Valverde'],['28','Monseñor Nouel'],['29','Monte Plata'],
  ['30','Hato Mayor'],['31','San José de Ocoa'],['32','Santo Domingo'],
].map(([code, name]) => ({ code, name }));

/** Dominican Republic: who the market is. */
export const profile: MarketProfile = {
  name: 'República Dominicana',
  currency: 'DOP',
  locale: 'es-DO',
  booksLanguage: 'es',
  timeZone: 'America/Santo_Domingo',
  callingCode: '1',
  fiscalAuthority: 'DGII',
  address: {
    divisionLabel: 'Provincia',
    divisionLabelKey: 'fiscal.labels.province',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{5}$',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.' },
  examples: { city: 'Santo Domingo', postalCode: '10101', phone: '809 555 0123' },
  marketStatus: 'available',
};
