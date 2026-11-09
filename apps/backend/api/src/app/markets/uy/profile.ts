// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * DGI/INE departamentos.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['MO', 'Montevideo'],
  ['AR', 'Artigas'],
  ['CA', 'Canelones'],
  ['CL', 'Cerro Largo'],
  ['CO', 'Colonia'],
  ['DU', 'Durazno'],
  ['FS', 'Flores'],
  ['FD', 'Florida'],
  ['LA', 'Lavalleja'],
  ['MA', 'Maldonado'],
  ['PA', 'Paysandú'],
  ['RN', 'Río Negro'],
  ['RV', 'Rivera'],
  ['RO', 'Rocha'],
  ['SA', 'Salto'],
  ['SJ', 'San José'],
  ['SO', 'Soriano'],
  ['TA', 'Tacuarembó'],
  ['TT', 'Treinta y Tres'],
].map(([code, name]) => ({ code, name }));

/** Uruguay: who the market is. */
export const profile: MarketProfile = {
  name: 'Uruguay',
  currency: 'UYU',
  locale: 'es-UY',
  booksLanguage: 'es',
  timeZone: 'America/Montevideo',
  callingCode: '598',
  fiscalAuthority: 'DGI',
  address: {
    divisionLabel: 'Departamento',
    divisionLabelKey: 'fiscal.labels.department',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{5}$',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',' },
  examples: { city: 'Montevideo', postalCode: '11000', phone: '2 555 0123' },
  marketStatus: 'preview',
};
