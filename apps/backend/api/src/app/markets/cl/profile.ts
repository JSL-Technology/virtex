// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * SII regiones, in the official ordinal order. The DTE carries the commune, and the region is
 * the level above it that the taxpayer's own address is registered at.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['AP', 'Arica y Parinacota'],
  ['TA', 'Tarapacá'],
  ['AN', 'Antofagasta'],
  ['AT', 'Atacama'],
  ['CO', 'Coquimbo'],
  ['VS', 'Valparaíso'],
  ['RM', 'Región Metropolitana de Santiago'],
  ['LI', 'Libertador General Bernardo O\'Higgins'],
  ['ML', 'Maule'],
  ['NB', 'Ñuble'],
  ['BI', 'Biobío'],
  ['AR', 'La Araucanía'],
  ['LR', 'Los Ríos'],
  ['LL', 'Los Lagos'],
  ['AI', 'Aysén del General Carlos Ibáñez del Campo'],
  ['MA', 'Magallanes y de la Antártica Chilena'],
].map(([code, name]) => ({ code, name }));

/** Chile: who the market is. */
export const profile: MarketProfile = {
  name: 'Chile',
  currency: 'CLP',
  locale: 'es-CL',
  booksLanguage: 'es',
  timeZone: 'America/Santiago',
  callingCode: '56',
  fiscalAuthority: 'SII',
  address: {
    divisionLabel: 'Región',
    divisionLabelKey: 'fiscal.labels.region',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodePattern: '^\\d{7}$',
    postalCodeRequired: false,
  },
  formats: { date: 'dd-MM-yyyy', thousandSeparator: '.', decimalSeparator: ',' },
  examples: { city: 'Santiago', postalCode: '8320000', phone: '2 2555 0123' },
  marketStatus: 'available',
};
