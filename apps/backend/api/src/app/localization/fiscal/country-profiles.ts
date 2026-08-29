/**
 * The markets this product is sold in, and what each one requires at signup.
 *
 * This replaces two competing sources that disagreed with each other: a hardcoded three-country
 * array in `libs/api/country`, and six `FiscalRegion` rows seeded from `LocalizationService`.
 * The signup form offered eight countries; six were seeded; two of those eight (Costa Rica and
 * Peru) therefore fell through to a "generic" profile that accepted any tax id, produced no
 * fiscal region id, and left the new tenant with no chart of accounts and no taxes — silently,
 * with a success message.
 *
 * One list, and it is the authority. A country that is not here cannot be registered, which is
 * the correct behaviour for a fiscal product: an unvalidated tax id is not a smaller problem than
 * a rejected signup, it is a larger one that surfaces months later.
 *
 * The address fields are not decoration. United States sales tax is destination-based, so a rate
 * cannot be determined without state and ZIP; Mexican, Chilean, Colombian and Peruvian electronic
 * invoicing all require a structured fiscal address in the stamped document. Collecting a single
 * free-text line means the data has to be re-collected before any of that can work.
 */

export interface AdministrativeDivision {
  /** Official code as it appears in the tax authority's catalogue. */
  code: string;
  name: string;
}

export interface CountryFiscalProfile {
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  name: string;
  /** ISO 4217. */
  currency: string;
  /** BCP 47, for number and date formatting. */
  locale: string;
  /** E.164 calling code, without the leading '+'. */
  callingCode: string;

  fiscalAuthority: string;

  taxId: {
    /** What the field is called in that country. Shown as the input's label. */
    label: string;
    /** Example value, shown as the placeholder. Never a real registered identifier. */
    example: string;
    /**
     * Client-side shape check, for immediate feedback only. The authoritative check is the
     * algorithmic validator in `tax-id-validators.ts`, which runs on the server.
     */
    pattern: string;
    /** True when the identifier carries a check digit the validator verifies arithmetically. */
    hasCheckDigit: boolean;
  };

  address: {
    /** What the first-level division is called locally: State, Provincia, Departamento… */
    divisionLabel: string;
    /** First-level divisions, where the country's e-invoicing requires a coded value. */
    divisions?: AdministrativeDivision[];
    postalCodeLabel: string;
    postalCodePattern?: string;
    postalCodeRequired: boolean;
  };

  /**
   * A second identifier, where the country issues a different one to natural persons than to
   * companies. The United States is the clearest case: a sole proprietor files under an SSN or
   * ITIN, not an EIN, and rejecting that shape would lock out a whole class of customer.
   */
  individualDocument?: { code: string; label: string; pattern: string };

  /** Whether the country mandates electronic invoicing, and which regime. */
  electronicInvoicing: { required: boolean; regime: string | null };

  /**
   * Periodic filings the tax authority requires, by their official name. Only populated where the
   * obligation is named and specific; an empty list means "not modelled here", never "none".
   */
  requiredFiscalReports?: string[];

  dateFormat: string;
  thousandSeparator: string;
  decimalSeparator: string;
}

const MEXICAN_STATES: AdministrativeDivision[] = [
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

const US_STATES: AdministrativeDivision[] = [
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

const DOMINICAN_PROVINCES: AdministrativeDivision[] = [
  ['01','Distrito Nacional'],['02','Azua'],['03','Baoruco'],['04','Barahona'],['05','Dajabón'],
  ['06','Duarte'],['07','Elías Piña'],['08','El Seibo'],['09','Espaillat'],['10','Independencia'],
  ['11','La Altagracia'],['12','La Romana'],['13','La Vega'],['14','María Trinidad Sánchez'],
  ['15','Monte Cristi'],['16','Pedernales'],['17','Peravia'],['18','Puerto Plata'],
  ['19','Hermanas Mirabal'],['20','Samaná'],['21','San Cristóbal'],['22','San Juan'],
  ['23','San Pedro de Macorís'],['24','Sánchez Ramírez'],['25','Santiago'],
  ['26','Santiago Rodríguez'],['27','Valverde'],['28','Monseñor Nouel'],['29','Monte Plata'],
  ['30','Hato Mayor'],['31','San José de Ocoa'],['32','Santo Domingo'],
].map(([code, name]) => ({ code, name }));

/**
 * Every market, in the order they are offered.
 *
 * Adding one means adding a validator in `tax-id-validators.ts`, a chart-of-accounts template and
 * a tax scheme. Anything less produces a tenant that can register and then cannot invoice, which
 * is the failure this list exists to prevent.
 */
export const COUNTRY_FISCAL_PROFILES: readonly CountryFiscalProfile[] = [
  {
    countryCode: 'DO', name: 'República Dominicana', currency: 'DOP', locale: 'es-DO',
    callingCode: '1', fiscalAuthority: 'DGII',
    taxId: { label: 'RNC / Cédula', example: '131-12345-7', pattern: '^\\d{3}-?\\d{5}-?\\d$|^\\d{11}$', hasCheckDigit: true },
    individualDocument: { code: 'CEDULA', label: 'Cédula', pattern: '^\\d{11}$' },
    address: { divisionLabel: 'Provincia', divisions: DOMINICAN_PROVINCES, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DGII e-CF' },
    requiredFiscalReports: ['606', '607', '608', 'IT-1'],
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'US', name: 'United States', currency: 'USD', locale: 'en-US',
    callingCode: '1', fiscalAuthority: 'IRS',
    taxId: { label: 'EIN', example: '12-3456789', pattern: '^\\d{2}-?\\d{7}$', hasCheckDigit: false },
    // Sales tax is destination-based: without state and ZIP+4 no rate can be determined.
    individualDocument: { code: 'SSN', label: 'SSN / ITIN', pattern: '^\\d{3}-?\\d{2}-?\\d{4}$' },
    address: { divisionLabel: 'State', divisions: US_STATES, postalCodeLabel: 'ZIP code', postalCodePattern: '^\\d{5}(-\\d{4})?$', postalCodeRequired: true },
    electronicInvoicing: { required: false, regime: null },
    dateFormat: 'MM/dd/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'MX', name: 'México', currency: 'MXN', locale: 'es-MX',
    callingCode: '52', fiscalAuthority: 'SAT',
    taxId: { label: 'RFC', example: 'DEM010203AB5', pattern: '^[A-ZÑ&]{3,4}\\d{6}[A-Z\\d]{3}$', hasCheckDigit: true },
    address: { divisionLabel: 'Estado', divisions: MEXICAN_STATES, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: true },
    electronicInvoicing: { required: true, regime: 'CFDI 4.0' },
    requiredFiscalReports: ['DIOT'],
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'CO', name: 'Colombia', currency: 'COP', locale: 'es-CO',
    callingCode: '57', fiscalAuthority: 'DIAN',
    taxId: { label: 'NIT', example: '900123456-8', pattern: '^\\d{9,10}-?\\d$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{6}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DIAN Factura Electrónica' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'CL', name: 'Chile', currency: 'CLP', locale: 'es-CL',
    callingCode: '56', fiscalAuthority: 'SII',
    taxId: { label: 'RUT', example: '76.086.428-5', pattern: '^\\d{1,2}\\.?\\d{3}\\.?\\d{3}-?[0-9Kk]$', hasCheckDigit: true },
    address: { divisionLabel: 'Región', postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{7}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SII DTE' },
    dateFormat: 'dd-MM-yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'PE', name: 'Perú', currency: 'PEN', locale: 'es-PE',
    callingCode: '51', fiscalAuthority: 'SUNAT',
    taxId: { label: 'RUC', example: '20123456786', pattern: '^(10|15|17|20)\\d{9}$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SUNAT CPE' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'AR', name: 'Argentina', currency: 'ARS', locale: 'es-AR',
    callingCode: '54', fiscalAuthority: 'AFIP',
    taxId: { label: 'CUIT', example: '30-71234567-1', pattern: '^\\d{2}-?\\d{8}-?\\d$', hasCheckDigit: true },
    address: { divisionLabel: 'Provincia', postalCodeLabel: 'Código postal', postalCodePattern: '^[A-Z]?\\d{4}[A-Z]{0,3}$', postalCodeRequired: true },
    electronicInvoicing: { required: true, regime: 'AFIP CAE' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'BR', name: 'Brasil', currency: 'BRL', locale: 'pt-BR',
    callingCode: '55', fiscalAuthority: 'Receita Federal',
    taxId: { label: 'CNPJ', example: '11.222.333/0001-81', pattern: '^\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}$', hasCheckDigit: true },
    address: { divisionLabel: 'Estado', postalCodeLabel: 'CEP', postalCodePattern: '^\\d{5}-?\\d{3}$', postalCodeRequired: true },
    electronicInvoicing: { required: true, regime: 'NF-e' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'EC', name: 'Ecuador', currency: 'USD', locale: 'es-EC',
    callingCode: '593', fiscalAuthority: 'SRI',
    taxId: { label: 'RUC', example: '1790123456001', pattern: '^\\d{13}$', hasCheckDigit: true },
    address: { divisionLabel: 'Provincia', postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{6}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SRI Comprobantes Electrónicos' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'UY', name: 'Uruguay', currency: 'UYU', locale: 'es-UY',
    callingCode: '598', fiscalAuthority: 'DGI',
    taxId: { label: 'RUT', example: '211003420017', pattern: '^\\d{12}$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DGI CFE' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'PY', name: 'Paraguay', currency: 'PYG', locale: 'es-PY',
    callingCode: '595', fiscalAuthority: 'SET',
    taxId: { label: 'RUC', example: '80012345-0', pattern: '^\\d{5,8}-?\\d$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{4}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SET e-Kuatia' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'BO', name: 'Bolivia', currency: 'BOB', locale: 'es-BO',
    callingCode: '591', fiscalAuthority: 'SIN',
    taxId: { label: 'NIT', example: '1234567890', pattern: '^\\d{7,12}$', hasCheckDigit: false },
    address: { divisionLabel: 'Departamento', postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SIN Facturación en Línea' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'VE', name: 'Venezuela', currency: 'VES', locale: 'es-VE',
    callingCode: '58', fiscalAuthority: 'SENIAT',
    taxId: { label: 'RIF', example: 'J-30599168-5', pattern: '^[VEJPGvejpg]-?\\d{8}-?\\d$', hasCheckDigit: true },
    address: { divisionLabel: 'Estado', postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{4}$', postalCodeRequired: false },
    electronicInvoicing: { required: false, regime: null },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'PA', name: 'Panamá', currency: 'PAB', locale: 'es-PA',
    callingCode: '507', fiscalAuthority: 'DGI',
    taxId: { label: 'RUC', example: '15512345-2-2018', pattern: '^[\\dA-Za-z]+(-[\\dA-Za-z]+){1,4}$', hasCheckDigit: false },
    address: { divisionLabel: 'Provincia', postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DGI SFEP' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'CR', name: 'Costa Rica', currency: 'CRC', locale: 'es-CR',
    callingCode: '506', fiscalAuthority: 'Ministerio de Hacienda',
    taxId: { label: 'Cédula jurídica', example: '3101123456', pattern: '^\\d{9,12}$', hasCheckDigit: false },
    address: { divisionLabel: 'Provincia', postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'Hacienda Factura Electrónica' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'GT', name: 'Guatemala', currency: 'GTQ', locale: 'es-GT',
    callingCode: '502', fiscalAuthority: 'SAT',
    taxId: { label: 'NIT', example: '1234567-9', pattern: '^\\d{2,12}-?[0-9Kk]$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SAT FEL' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'SV', name: 'El Salvador', currency: 'USD', locale: 'es-SV',
    callingCode: '503', fiscalAuthority: 'Ministerio de Hacienda',
    taxId: { label: 'NIT', example: '0614-123456-001-2', pattern: '^\\d{4}-?\\d{6}-?\\d{3}-?\\d$', hasCheckDigit: false },
    address: { divisionLabel: 'Departamento', postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DTE El Salvador' },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'HN', name: 'Honduras', currency: 'HNL', locale: 'es-HN',
    callingCode: '504', fiscalAuthority: 'SAR',
    taxId: { label: 'RTN', example: '08019012345678', pattern: '^\\d{14}$', hasCheckDigit: false },
    address: { divisionLabel: 'Departamento', postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: false, regime: null },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'NI', name: 'Nicaragua', currency: 'NIO', locale: 'es-NI',
    callingCode: '505', fiscalAuthority: 'DGI',
    taxId: { label: 'RUC', example: 'J0310000012345', pattern: '^[A-Za-z0-9]{14}$', hasCheckDigit: false },
    address: { divisionLabel: 'Departamento', postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: false, regime: null },
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
];

const BY_CODE = new Map(COUNTRY_FISCAL_PROFILES.map((p) => [p.countryCode, p]));

export function findCountryProfile(countryCode: string): CountryFiscalProfile | undefined {
  return BY_CODE.get(countryCode?.toUpperCase() ?? '');
}

export function supportedCountryCodes(): string[] {
  return COUNTRY_FISCAL_PROFILES.map((p) => p.countryCode);
}
