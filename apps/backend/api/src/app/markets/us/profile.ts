// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { AdministrativeDivision, MarketProfile } from '../contracts';

const DIVISIONS: readonly AdministrativeDivision[] = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],
  ['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],
  ['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],
  ['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],
  ['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
  ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],
  ['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],
  ['PA','Pennsylvania'],['PR','Puerto Rico'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],
  ['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
].map(([code, name]) => ({ code, name }));

/** United States: who the market is. */
export const profile: MarketProfile = {
  name: 'United States',
  currency: 'USD',
  locale: 'en-US',
  booksLanguage: 'en',
  timeZone: 'America/New_York',
  callingCode: '1',
  fiscalAuthority: 'IRS',
  address: {
    divisionLabel: 'State',
    divisionLabelKey: 'fiscal.labels.state',
    divisions: DIVISIONS,
    postalCodeLabel: 'ZIP code',
    postalCodePattern: '^\\d{5}(-\\d{4})?$',
    postalCodeRequired: true,
  },
  formats: { date: 'MM/dd/yyyy', thousandSeparator: ',', decimalSeparator: '.' },
  examples: { city: 'Austin', postalCode: '78701', phone: '(512) 555-0123' },
  marketStatus: 'preview',
};
