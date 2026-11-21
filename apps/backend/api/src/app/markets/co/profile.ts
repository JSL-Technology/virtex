// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * DANE departamentos. The code is what DIAN's invoice XML carries in `ID` for the fiscal
 * address; the two-digit form is the department, and it is the level the e-invoicing schema
 * requires.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['05', 'Antioquia'],
  ['08', 'Atlántico'],
  ['11', 'Bogotá D.C.'],
  ['13', 'Bolívar'],
  ['15', 'Boyacá'],
  ['17', 'Caldas'],
  ['18', 'Caquetá'],
  ['19', 'Cauca'],
  ['20', 'Cesar'],
  ['23', 'Córdoba'],
  ['25', 'Cundinamarca'],
  ['27', 'Chocó'],
  ['41', 'Huila'],
  ['44', 'La Guajira'],
  ['47', 'Magdalena'],
  ['50', 'Meta'],
  ['52', 'Nariño'],
  ['54', 'Norte de Santander'],
  ['63', 'Quindío'],
  ['66', 'Risaralda'],
  ['68', 'Santander'],
  ['70', 'Sucre'],
  ['73', 'Tolima'],
  ['76', 'Valle del Cauca'],
  ['81', 'Arauca'],
  ['85', 'Casanare'],
  ['86', 'Putumayo'],
  ['88', 'San Andrés y Providencia'],
  ['91', 'Amazonas'],
  ['94', 'Guainía'],
  ['95', 'Guaviare'],
  ['97', 'Vaupés'],
  ['99', 'Vichada'],
].map(([code, name]) => ({ code, name }));

/** Colombia: who the market is. */
export const profile: MarketProfile = {
  name: 'Colombia',
  currency: 'COP',
  locale: 'es-CO',
  booksLanguage: 'es',
  timeZone: 'America/Bogota',
  callingCode: '57',
  fiscalAuthority: 'DIAN',
  address: {
    divisionLabel: 'Departamento',
    divisionLabelKey: 'fiscal.labels.department',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{6}$',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',' },
  examples: { city: 'Bogotá', postalCode: '110111', phone: '601 555 0123' },
  marketStatus: 'available',
};
