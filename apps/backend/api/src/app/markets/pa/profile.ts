// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

/**
 * DGI provincias and comarcas indígenas, which are first-level divisions in their own right
 * and not sub-divisions of a province.
 */
const DIVISIONS: readonly AdministrativeDivision[] = [
  ['01', 'Bocas del Toro'],
  ['02', 'Coclé'],
  ['03', 'Colón'],
  ['04', 'Chiriquí'],
  ['05', 'Darién'],
  ['06', 'Herrera'],
  ['07', 'Los Santos'],
  ['08', 'Panamá'],
  ['09', 'Veraguas'],
  ['10', 'Guna Yala'],
  ['11', 'Emberá-Wounaan'],
  ['12', 'Ngäbe-Buglé'],
  ['13', 'Panamá Oeste'],
  ['14', 'Naso Tjër Di'],
].map(([code, name]) => ({ code, name }));

/** Panama: who the market is. */
export const profile: MarketProfile = {
  name: 'Panamá',
  currency: 'PAB',
  locale: 'es-PA',
  booksLanguage: 'es',
  timeZone: 'America/Panama',
  callingCode: '507',
  fiscalAuthority: 'DGI',
  address: {
    divisionLabel: 'Provincia',
    divisionLabelKey: 'fiscal.labels.province',
    divisions: DIVISIONS,
    postalCodeLabel: 'Código postal',
    postalCodeLabelKey: 'fiscal.labels.postal_code',
    postalCodeRequired: false,
  },
  formats: { date: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.' },
  examples: { city: 'Ciudad de Panamá', postalCode: null, phone: '255 0123' },
  marketStatus: 'preview',
};
