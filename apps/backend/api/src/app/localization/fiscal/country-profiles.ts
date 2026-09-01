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

/** One entry of a tax authority's published catalogue. */
export interface FiscalFieldOption {
  /** The code as the authority publishes it. Stored verbatim; it goes on the invoice. */
  code: string;
  label: string;
  /** Restrict the option to one kind of taxpayer, where the catalogue does. */
  appliesTo?: readonly TaxpayerKindValue[];
}

/** Mirrors `TaxpayerKind` in `tax-id-validators.ts`, kept as a string union to avoid a cycle. */
export type TaxpayerKindValue = 'company' | 'individual';

/**
 * A fiscal datum a country requires beyond name, tax id and address.
 *
 * These are not optional extras. A CFDI 4.0 cannot be stamped without the issuer's
 * `RegimenFiscal`; an AFIP invoice needs the issuer's `Condición frente al IVA` and a
 * `Punto de Venta`; DIAN needs the taxpayer's `responsabilidades fiscales`; an NF-e needs the
 * `CRT` and, unless exempt, the `Inscrição Estadual`. Collecting them after the fact means asking
 * a paying customer to re-do onboarding before they can issue their first document.
 *
 * Declared as data so the signup form renders them generically and the server validates them from
 * the same source — the arrangement that stops the two from drifting.
 */
export interface FiscalFieldSpec {
  /** Key under which the answer is stored in `organizations.fiscal_profile`. */
  key: string;
  label: string;
  /** Shown under the field. Explains why the authority needs it. */
  help?: string;
  required: boolean;
  type: 'select' | 'text';
  /**
   * True when the authority admits SEVERAL answers at once.
   *
   * Colombia is the case that forced this: a RUT lists every `responsabilidad fiscal` the
   * taxpayer holds — a large taxpayer that is also a VAT withholding agent carries `O-13` and
   * `O-23` — and DIAN's invoice XML carries them as a list. Modelling it as a single select
   * meant the tenant had to pick one and the invoice would then be wrong for the others.
   */
  multiple?: boolean;
  /** For `select`. Codes are the authority's own. */
  options?: readonly FiscalFieldOption[];
  /** For `text`. Anchored on both ends by the validator. */
  pattern?: string;
  /** Placeholder, and the shape a support agent will recognise. */
  example?: string;
  /** Restrict the whole field to one kind of taxpayer. */
  appliesTo?: readonly TaxpayerKindValue[];
}

export interface CountryFiscalProfile {
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  name: string;
  /** ISO 4217. */
  currency: string;
  /** BCP 47, for number and date formatting. */
  locale: string;
  /**
   * IANA time zone of the country's fiscal day.
   *
   * A comprobante's `FechaHoraFirma`, its emission date and the cut-off of a monthly return are all
   * statements about local time in the issuer's country, and the server that produces them runs in
   * UTC. Stamping server time meant a Dominican sale made at 20:30 was signed as 00:30 the
   * following day — a signature dated after the emission date, which the DGII rejects, and a sale
   * booked into the wrong month at every month end.
   *
   * Countries spanning several zones carry their commercial centre's; a tenant that sits in another
   * one overrides it on `organizations.timezone`.
   */
  timeZone: string;
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
   * How much of the product this market actually gets today.
   *
   * `electronicInvoicing.required` describes the country's law. This describes our implementation,
   * and the two were silently conflated: the signup form told a Mexican customer "México exige
   * facturación electrónica (CFDI 4.0). Estos datos forman parte del comprobante, por eso los
   * pedimos ahora", validated their RFC, took their money — and handed them a fiscal adapter that
   * does nothing, because only the Dominican one exists.
   *
   *   - `available` — a real fiscal adapter backs the country's regime; documents can be issued.
   *   - `preview`   — everything else in the ERP works (accounting, inventory, procurement,
   *                   payroll, reporting), but the country's e-invoicing regime is not implemented
   *                   yet, so documents cannot be stamped.
   *
   * `preview` deliberately does NOT block signup. Refusing eighteen markets because one module is
   * missing would be a worse answer than the bug: the customer can use the product and knows what
   * they are buying. What it does is force the disclosure to appear on the plan step, before
   * payment, instead of a promise that is not kept afterwards.
   */
  marketStatus: 'available' | 'preview';

  /** Country-specific fiscal data the authority requires. See {@link FiscalFieldSpec}. */
  fiscalFields?: readonly FiscalFieldSpec[];

  /**
   * Periodic filings the tax authority requires, by their official name. Only populated where the
   * obligation is named and specific; an empty list means "not modelled here", never "none".
   */
  requiredFiscalReports?: string[];

  dateFormat: string;
  thousandSeparator: string;
  decimalSeparator: string;
}

/**
 * Catalogue snapshots.
 *
 * These are the tax authorities' own code lists, reproduced verbatim because the codes — not the
 * labels — are what goes into the stamped document. They are snapshots: an authority that
 * publishes a new version of its catalogue makes this file stale, so each one carries the version
 * it was taken from and `fiscal-coverage.spec.ts` asserts that every referenced code is
 * well-formed. Adding a market means adding its catalogue here, not hardcoding a string at a call
 * site.
 */

/** SAT `c_RegimenFiscal`, CFDI 4.0. Required on every issued document. */
const MEXICAN_TAX_REGIMES: readonly FiscalFieldOption[] = [
  { code: '601', label: 'General de Ley Personas Morales', appliesTo: ['company'] },
  { code: '603', label: 'Personas Morales con Fines no Lucrativos', appliesTo: ['company'] },
  { code: '605', label: 'Sueldos y Salarios e Ingresos Asimilados a Salarios', appliesTo: ['individual'] },
  { code: '606', label: 'Arrendamiento', appliesTo: ['individual'] },
  { code: '607', label: 'Régimen de Enajenación o Adquisición de Bienes', appliesTo: ['individual'] },
  { code: '608', label: 'Demás ingresos', appliesTo: ['individual'] },
  { code: '610', label: 'Residentes en el Extranjero sin Establecimiento Permanente en México' },
  { code: '611', label: 'Ingresos por Dividendos (socios y accionistas)', appliesTo: ['individual'] },
  { code: '612', label: 'Personas Físicas con Actividades Empresariales y Profesionales', appliesTo: ['individual'] },
  { code: '614', label: 'Ingresos por intereses', appliesTo: ['individual'] },
  { code: '615', label: 'Régimen de los ingresos por obtención de premios', appliesTo: ['individual'] },
  { code: '616', label: 'Sin obligaciones fiscales', appliesTo: ['individual'] },
  { code: '620', label: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos', appliesTo: ['company'] },
  { code: '621', label: 'Incorporación Fiscal', appliesTo: ['individual'] },
  { code: '622', label: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras', appliesTo: ['company'] },
  { code: '623', label: 'Opcional para Grupos de Sociedades', appliesTo: ['company'] },
  { code: '624', label: 'Coordinados', appliesTo: ['company'] },
  { code: '625', label: 'Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', appliesTo: ['individual'] },
  { code: '626', label: 'Régimen Simplificado de Confianza (RESICO)' },
];

/** AFIP — condición del emisor frente al IVA. Determines which invoice class may be issued. */
const ARGENTINE_VAT_CONDITIONS: readonly FiscalFieldOption[] = [
  { code: '1', label: 'IVA Responsable Inscripto' },
  { code: '4', label: 'IVA Sujeto Exento' },
  { code: '5', label: 'Consumidor Final' },
  { code: '6', label: 'Responsable Monotributo' },
  { code: '13', label: 'Monotributista Social' },
  { code: '16', label: 'Monotributo Trabajador Independiente Promovido' },
];

/** DIAN — responsabilidades fiscales, as printed on the RUT and carried in the invoice XML. */
const COLOMBIAN_FISCAL_RESPONSIBILITIES: readonly FiscalFieldOption[] = [
  { code: 'O-13', label: 'Gran contribuyente' },
  { code: 'O-15', label: 'Autorretenedor' },
  { code: 'O-23', label: 'Agente de retención IVA' },
  { code: 'O-47', label: 'Régimen simple de tributación' },
  { code: 'R-99-PN', label: 'No responsable de IVA' },
];

/** Receita Federal — Código de Regime Tributário, mandatory on every NF-e. */
const BRAZILIAN_TAX_REGIMES: readonly FiscalFieldOption[] = [
  { code: '1', label: 'Simples Nacional' },
  { code: '2', label: 'Simples Nacional — excesso de sublimite de receita bruta' },
  { code: '3', label: 'Regime Normal' },
  { code: '4', label: 'Simples Nacional — Microempreendedor Individual (MEI)' },
];

/** SRI — whether the taxpayer is required to keep formal accounting books. */
const YES_NO: readonly FiscalFieldOption[] = [
  { code: 'SI', label: 'Sí' },
  { code: 'NO', label: 'No' },
];

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
 * DANE departamentos. The code is what DIAN's invoice XML carries in `ID` for the fiscal
 * address; the two-digit form is the department, and it is the level the e-invoicing schema
 * requires.
 */
const COLOMBIAN_DEPARTMENTS: AdministrativeDivision[] = [
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

/**
 * SII regiones, in the official ordinal order. The DTE carries the commune, and the region is
 * the level above it that the taxpayer's own address is registered at.
 */
const CHILEAN_REGIONS: AdministrativeDivision[] = [
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

/**
 * INEI departamentos. The first two digits of the six-digit ubigeo SUNAT requires on the
 * electronic receipt, collected separately so the two cannot disagree.
 */
const PERUVIAN_DEPARTMENTS: AdministrativeDivision[] = [
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

/**
 * IBGE unidades federativas. The UF is what an NF-e carries, and it decides the ICMS regime,
 * so free text here is not a smaller problem than a missing field.
 */
const BRAZILIAN_STATES: AdministrativeDivision[] = [
  ['AC', 'Acre'],
  ['AL', 'Alagoas'],
  ['AP', 'Amapá'],
  ['AM', 'Amazonas'],
  ['BA', 'Bahia'],
  ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'],
  ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'],
  ['MA', 'Maranhão'],
  ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'],
  ['PA', 'Pará'],
  ['PB', 'Paraíba'],
  ['PR', 'Paraná'],
  ['PE', 'Pernambuco'],
  ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'],
  ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'],
  ['RR', 'Roraima'],
  ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'],
  ['SE', 'Sergipe'],
  ['TO', 'Tocantins'],
].map(([code, name]) => ({ code, name }));

/**
 * AFIP/INDEC provincias. The code is the one AFIP publishes for the issuer's address on an
 * electronic invoice.
 */
const ARGENTINE_PROVINCES: AdministrativeDivision[] = [
  ['00', 'Ciudad Autónoma de Buenos Aires'],
  ['01', 'Buenos Aires'],
  ['02', 'Catamarca'],
  ['03', 'Córdoba'],
  ['04', 'Corrientes'],
  ['05', 'Entre Ríos'],
  ['06', 'Jujuy'],
  ['07', 'Mendoza'],
  ['08', 'La Rioja'],
  ['09', 'Salta'],
  ['10', 'San Juan'],
  ['11', 'San Luis'],
  ['12', 'Santa Fe'],
  ['13', 'Santiago del Estero'],
  ['14', 'Tucumán'],
  ['16', 'Chaco'],
  ['17', 'Chubut'],
  ['18', 'Formosa'],
  ['19', 'Misiones'],
  ['20', 'Neuquén'],
  ['21', 'La Pampa'],
  ['22', 'Río Negro'],
  ['23', 'Santa Cruz'],
  ['24', 'Tierra del Fuego'],
].map(([code, name]) => ({ code, name }));

/**
 * INEC provincias. The first two digits of the SRI establishment code.
 */
const ECUADORIAN_PROVINCES: AdministrativeDivision[] = [
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

/**
 * DGI/INE departamentos.
 */
const URUGUAYAN_DEPARTMENTS: AdministrativeDivision[] = [
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

/**
 * SET/DGEEC departamentos, with Asunción as the capital district.
 */
const PARAGUAYAN_DEPARTMENTS: AdministrativeDivision[] = [
  ['00', 'Asunción'],
  ['01', 'Concepción'],
  ['02', 'San Pedro'],
  ['03', 'Cordillera'],
  ['04', 'Guairá'],
  ['05', 'Caaguazú'],
  ['06', 'Caazapá'],
  ['07', 'Itapúa'],
  ['08', 'Misiones'],
  ['09', 'Paraguarí'],
  ['10', 'Alto Paraná'],
  ['11', 'Central'],
  ['12', 'Ñeembucú'],
  ['13', 'Amambay'],
  ['14', 'Canindeyú'],
  ['15', 'Presidente Hayes'],
  ['16', 'Alto Paraguay'],
  ['17', 'Boquerón'],
].map(([code, name]) => ({ code, name }));

/**
 * SIN/INE departamentos.
 */
const BOLIVIAN_DEPARTMENTS: AdministrativeDivision[] = [
  ['01', 'Chuquisaca'],
  ['02', 'La Paz'],
  ['03', 'Cochabamba'],
  ['04', 'Oruro'],
  ['05', 'Potosí'],
  ['06', 'Tarija'],
  ['07', 'Santa Cruz'],
  ['08', 'Beni'],
  ['09', 'Pando'],
].map(([code, name]) => ({ code, name }));

/**
 * SENIAT/INE estados, including the Capital District.
 */
const VENEZUELAN_STATES: AdministrativeDivision[] = [
  ['01', 'Distrito Capital'],
  ['02', 'Amazonas'],
  ['03', 'Anzoátegui'],
  ['04', 'Apure'],
  ['05', 'Aragua'],
  ['06', 'Barinas'],
  ['07', 'Bolívar'],
  ['08', 'Carabobo'],
  ['09', 'Cojedes'],
  ['10', 'Delta Amacuro'],
  ['11', 'Falcón'],
  ['12', 'Guárico'],
  ['13', 'Lara'],
  ['14', 'Mérida'],
  ['15', 'Miranda'],
  ['16', 'Monagas'],
  ['17', 'Nueva Esparta'],
  ['18', 'Portuguesa'],
  ['19', 'Sucre'],
  ['20', 'Táchira'],
  ['21', 'Trujillo'],
  ['22', 'La Guaira'],
  ['23', 'Yaracuy'],
  ['24', 'Zulia'],
  ['25', 'Dependencias Federales'],
].map(([code, name]) => ({ code, name }));

/**
 * DGI provincias and comarcas indígenas, which are first-level divisions in their own right
 * and not sub-divisions of a province.
 */
const PANAMANIAN_PROVINCES: AdministrativeDivision[] = [
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

/**
 * Hacienda provincias — the first digit of the location code the electronic invoice carries.
 */
const COSTA_RICAN_PROVINCES: AdministrativeDivision[] = [
  ['1', 'San José'],
  ['2', 'Alajuela'],
  ['3', 'Cartago'],
  ['4', 'Heredia'],
  ['5', 'Guanacaste'],
  ['6', 'Puntarenas'],
  ['7', 'Limón'],
].map(([code, name]) => ({ code, name }));

/**
 * SAT/INE departamentos.
 */
const GUATEMALAN_DEPARTMENTS: AdministrativeDivision[] = [
  ['01', 'Guatemala'],
  ['02', 'El Progreso'],
  ['03', 'Sacatepéquez'],
  ['04', 'Chimaltenango'],
  ['05', 'Escuintla'],
  ['06', 'Santa Rosa'],
  ['07', 'Sololá'],
  ['08', 'Totonicapán'],
  ['09', 'Quetzaltenango'],
  ['10', 'Suchitepéquez'],
  ['11', 'Retalhuleu'],
  ['12', 'San Marcos'],
  ['13', 'Huehuetenango'],
  ['14', 'Quiché'],
  ['15', 'Baja Verapaz'],
  ['16', 'Alta Verapaz'],
  ['17', 'Petén'],
  ['18', 'Izabal'],
  ['19', 'Zacapa'],
  ['20', 'Chiquimula'],
  ['21', 'Jalapa'],
  ['22', 'Jutiapa'],
].map(([code, name]) => ({ code, name }));

/**
 * Ministerio de Hacienda departamentos — the code the DTE carries.
 */
const SALVADORAN_DEPARTMENTS: AdministrativeDivision[] = [
  ['01', 'Ahuachapán'],
  ['02', 'Santa Ana'],
  ['03', 'Sonsonate'],
  ['04', 'Chalatenango'],
  ['05', 'La Libertad'],
  ['06', 'San Salvador'],
  ['07', 'Cuscatlán'],
  ['08', 'La Paz'],
  ['09', 'Cabañas'],
  ['10', 'San Vicente'],
  ['11', 'Usulután'],
  ['12', 'San Miguel'],
  ['13', 'Morazán'],
  ['14', 'La Unión'],
].map(([code, name]) => ({ code, name }));

/**
 * SAR/INE departamentos.
 */
const HONDURAN_DEPARTMENTS: AdministrativeDivision[] = [
  ['01', 'Atlántida'],
  ['02', 'Colón'],
  ['03', 'Comayagua'],
  ['04', 'Copán'],
  ['05', 'Cortés'],
  ['06', 'Choluteca'],
  ['07', 'El Paraíso'],
  ['08', 'Francisco Morazán'],
  ['09', 'Gracias a Dios'],
  ['10', 'Intibucá'],
  ['11', 'Islas de la Bahía'],
  ['12', 'La Paz'],
  ['13', 'Lempira'],
  ['14', 'Ocotepeque'],
  ['15', 'Olancho'],
  ['16', 'Santa Bárbara'],
  ['17', 'Valle'],
  ['18', 'Yoro'],
].map(([code, name]) => ({ code, name }));

/**
 * DGI/INIDE departamentos and the two autonomous Caribbean regions.
 */
const NICARAGUAN_DEPARTMENTS: AdministrativeDivision[] = [
  ['05', 'Boaco'],
  ['10', 'Carazo'],
  ['20', 'Chinandega'],
  ['25', 'Chontales'],
  ['30', 'Estelí'],
  ['35', 'Granada'],
  ['40', 'Jinotega'],
  ['45', 'León'],
  ['50', 'Madriz'],
  ['55', 'Managua'],
  ['60', 'Masaya'],
  ['65', 'Matagalpa'],
  ['70', 'Nueva Segovia'],
  ['75', 'Río San Juan'],
  ['80', 'Rivas'],
  ['85', 'Costa Caribe Norte'],
  ['90', 'Costa Caribe Sur'],
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
    countryCode: 'DO', name: 'República Dominicana', currency: 'DOP', locale: 'es-DO', timeZone: 'America/Santo_Domingo',
    callingCode: '1', fiscalAuthority: 'DGII',
    taxId: { label: 'RNC / Cédula', example: '131-12345-7', pattern: '^\\d{3}-?\\d{5}-?\\d$|^\\d{11}$', hasCheckDigit: true },
    individualDocument: { code: 'CEDULA', label: 'Cédula', pattern: '^\\d{11}$' },
    address: { divisionLabel: 'Provincia', divisions: DOMINICAN_PROVINCES, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DGII e-CF' },
    marketStatus: 'available',
    fiscalFields: [
      {
        key: 'tipoIngreso', label: 'Tipo de ingreso', required: true, type: 'select',
        options: [
          { code: '01', label: 'Ingresos por operaciones (no financieros)' },
          { code: '02', label: 'Ingresos financieros' },
          { code: '03', label: 'Ingresos extraordinarios' },
          { code: '04', label: 'Ingresos por arrendamientos' },
          { code: '05', label: 'Ingresos por venta de activo depreciable' },
          { code: '06', label: 'Otros ingresos' },
        ],
        help: 'La DGII lo requiere en el e-CF y en el reporte 607.',
      },
    ],
    requiredFiscalReports: ['606', '607', '608', 'IT-1'],
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'US', name: 'United States', currency: 'USD', locale: 'en-US', timeZone: 'America/New_York',
    callingCode: '1', fiscalAuthority: 'IRS',
    taxId: { label: 'EIN', example: '12-3456789', pattern: '^\\d{2}-?\\d{7}$', hasCheckDigit: false },
    // Sales tax is destination-based: without state and ZIP+4 no rate can be determined.
    individualDocument: { code: 'SSN', label: 'SSN / ITIN', pattern: '^\\d{3}-?\\d{2}-?\\d{4}$' },
    address: { divisionLabel: 'State', divisions: US_STATES, postalCodeLabel: 'ZIP code', postalCodePattern: '^\\d{5}(-\\d{4})?$', postalCodeRequired: true },
    electronicInvoicing: { required: false, regime: null },
    marketStatus: 'preview',
    dateFormat: 'MM/dd/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'MX', name: 'México', currency: 'MXN', locale: 'es-MX', timeZone: 'America/Mexico_City',
    callingCode: '52', fiscalAuthority: 'SAT',
    taxId: { label: 'RFC', example: 'DEM010203AB5', pattern: '^[A-ZÑ&]{3,4}\\d{6}[A-Z\\d]{3}$', hasCheckDigit: true },
    address: { divisionLabel: 'Estado', divisions: MEXICAN_STATES, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: true },
    electronicInvoicing: { required: true, regime: 'CFDI 4.0' },
    marketStatus: 'preview',
    fiscalFields: [
      {
        key: 'regimenFiscal', label: 'Régimen fiscal', required: true, type: 'select',
        options: MEXICAN_TAX_REGIMES,
        help: 'El SAT lo exige en cada CFDI 4.0. Aparece en tu Constancia de Situación Fiscal.',
      },
    ],
    requiredFiscalReports: ['DIOT'],
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'CO', name: 'Colombia', currency: 'COP', locale: 'es-CO', timeZone: 'America/Bogota',
    callingCode: '57', fiscalAuthority: 'DIAN',
    taxId: { label: 'NIT', example: '900123456-8', pattern: '^\\d{9,10}-?\\d$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', divisions: COLOMBIAN_DEPARTMENTS, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{6}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DIAN Factura Electrónica' },
    marketStatus: 'preview',
    fiscalFields: [
      {
        key: 'responsabilidadesFiscales', label: 'Responsabilidades fiscales', required: true,
        type: 'select', multiple: true,
        options: COLOMBIAN_FISCAL_RESPONSIBILITIES,
        help: 'Selecciona todas las que figuren en tu RUT. Viajan como lista en el XML de la factura electrónica.',
      },
    ],
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'CL', name: 'Chile', currency: 'CLP', locale: 'es-CL', timeZone: 'America/Santiago',
    callingCode: '56', fiscalAuthority: 'SII',
    taxId: { label: 'RUT', example: '76.086.428-5', pattern: '^\\d{1,2}\\.?\\d{3}\\.?\\d{3}-?[0-9Kk]$', hasCheckDigit: true },
    address: { divisionLabel: 'Región', divisions: CHILEAN_REGIONS, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{7}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SII DTE' },
    marketStatus: 'preview',
    fiscalFields: [
      {
        key: 'giro', label: 'Giro comercial', required: true, type: 'text',
        pattern: '^.{3,80}$', example: 'Servicios de software',
        help: 'El SII lo imprime en cada documento tributario electrónico.',
      },
      {
        key: 'codigoActividadEconomica', label: 'Código de actividad económica', required: true, type: 'text',
        pattern: '^\\d{6}$', example: '620100',
      },
    ],
    dateFormat: 'dd-MM-yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'PE', name: 'Perú', currency: 'PEN', locale: 'es-PE', timeZone: 'America/Lima',
    callingCode: '51', fiscalAuthority: 'SUNAT',
    taxId: { label: 'RUC', example: '20123456786', pattern: '^(10|15|17|20)\\d{9}$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', divisions: PERUVIAN_DEPARTMENTS, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SUNAT CPE' },
    marketStatus: 'preview',
    fiscalFields: [
      {
        key: 'ubigeo', label: 'Ubigeo', required: true, type: 'text',
        pattern: '^\\d{6}$', example: '150101',
        help: 'Código de distrito del INEI. SUNAT lo exige en el comprobante electrónico.',
      },
    ],
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'AR', name: 'Argentina', currency: 'ARS', locale: 'es-AR', timeZone: 'America/Argentina/Buenos_Aires',
    callingCode: '54', fiscalAuthority: 'AFIP',
    taxId: { label: 'CUIT', example: '30-71234567-1', pattern: '^\\d{2}-?\\d{8}-?\\d$', hasCheckDigit: true },
    address: { divisionLabel: 'Provincia', divisions: ARGENTINE_PROVINCES, postalCodeLabel: 'Código postal', postalCodePattern: '^[A-Z]?\\d{4}[A-Z]{0,3}$', postalCodeRequired: true },
    electronicInvoicing: { required: true, regime: 'AFIP CAE' },
    marketStatus: 'preview',
    fiscalFields: [
      {
        key: 'condicionIva', label: 'Condición frente al IVA', required: true, type: 'select',
        options: ARGENTINE_VAT_CONDITIONS,
        help: 'Determina qué clase de comprobante (A, B, C) podés emitir.',
      },
      {
        key: 'puntoVenta', label: 'Punto de venta', required: true, type: 'text',
        pattern: '^\\d{1,5}$', example: '0001',
        help: 'El punto de venta habilitado en AFIP para facturación electrónica.',
      },
    ],
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'BR', name: 'Brasil', currency: 'BRL', locale: 'pt-BR', timeZone: 'America/Sao_Paulo',
    callingCode: '55', fiscalAuthority: 'Receita Federal',
    taxId: { label: 'CNPJ', example: '11.222.333/0001-81', pattern: '^\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}$', hasCheckDigit: true },
    address: { divisionLabel: 'Estado', divisions: BRAZILIAN_STATES, postalCodeLabel: 'CEP', postalCodePattern: '^\\d{5}-?\\d{3}$', postalCodeRequired: true },
    electronicInvoicing: { required: true, regime: 'NF-e' },
    marketStatus: 'preview',
    fiscalFields: [
      {
        key: 'regimeTributario', label: 'Regime tributário (CRT)', required: true, type: 'select',
        options: BRAZILIAN_TAX_REGIMES,
        help: 'Obrigatório em toda NF-e.',
      },
      {
        key: 'inscricaoEstadual', label: 'Inscrição Estadual', required: true, type: 'text',
        pattern: '^(ISENTO|[0-9.\\-/]{2,20})$', example: '123.456.789.110',
        help: 'Informe ISENTO se não for contribuinte de ICMS.',
      },
      {
        key: 'cnae', label: 'CNAE principal', required: false, type: 'text',
        pattern: '^\\d{7}$', example: '6201501',
      },
    ],
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'EC', name: 'Ecuador', currency: 'USD', locale: 'es-EC', timeZone: 'America/Guayaquil',
    callingCode: '593', fiscalAuthority: 'SRI',
    taxId: { label: 'RUC', example: '1790123456001', pattern: '^\\d{13}$', hasCheckDigit: true },
    address: { divisionLabel: 'Provincia', divisions: ECUADORIAN_PROVINCES, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{6}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SRI Comprobantes Electrónicos' },
    marketStatus: 'preview',
    fiscalFields: [
      {
        key: 'obligadoContabilidad', label: 'Obligado a llevar contabilidad', required: true, type: 'select',
        options: YES_NO,
        help: 'El SRI lo exige como campo del comprobante electrónico.',
      },
      {
        key: 'contribuyenteEspecial', label: 'N.º de resolución de contribuyente especial', required: false,
        type: 'text', pattern: '^[0-9A-Za-z\\-]{1,20}$', example: '12345',
      },
    ],
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'UY', name: 'Uruguay', currency: 'UYU', locale: 'es-UY', timeZone: 'America/Montevideo',
    callingCode: '598', fiscalAuthority: 'DGI',
    taxId: { label: 'RUT', example: '211003420017', pattern: '^\\d{12}$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', divisions: URUGUAYAN_DEPARTMENTS, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DGI CFE' },
    marketStatus: 'preview',
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'PY', name: 'Paraguay', currency: 'PYG', locale: 'es-PY', timeZone: 'America/Asuncion',
    callingCode: '595', fiscalAuthority: 'SET',
    taxId: { label: 'RUC', example: '80012345-0', pattern: '^\\d{5,8}-?\\d$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', divisions: PARAGUAYAN_DEPARTMENTS, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{4}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SET e-Kuatia' },
    marketStatus: 'preview',
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'BO', name: 'Bolivia', currency: 'BOB', locale: 'es-BO', timeZone: 'America/La_Paz',
    callingCode: '591', fiscalAuthority: 'SIN',
    taxId: { label: 'NIT', example: '1234567890', pattern: '^\\d{7,12}$', hasCheckDigit: false },
    address: { divisionLabel: 'Departamento', divisions: BOLIVIAN_DEPARTMENTS, postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SIN Facturación en Línea' },
    marketStatus: 'preview',
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'VE', name: 'Venezuela', currency: 'VES', locale: 'es-VE', timeZone: 'America/Caracas',
    callingCode: '58', fiscalAuthority: 'SENIAT',
    taxId: { label: 'RIF', example: 'J-30599168-5', pattern: '^[VEJPGvejpg]-?\\d{8}-?\\d$', hasCheckDigit: true },
    address: { divisionLabel: 'Estado', divisions: VENEZUELAN_STATES, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{4}$', postalCodeRequired: false },
    electronicInvoicing: { required: false, regime: null },
    marketStatus: 'preview',
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'PA', name: 'Panamá', currency: 'PAB', locale: 'es-PA', timeZone: 'America/Panama',
    callingCode: '507', fiscalAuthority: 'DGI',
    taxId: { label: 'RUC', example: '15512345-2-2018', pattern: '^[\\dA-Za-z]+(-[\\dA-Za-z]+){1,4}$', hasCheckDigit: false },
    address: { divisionLabel: 'Provincia', divisions: PANAMANIAN_PROVINCES, postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DGI SFEP' },
    marketStatus: 'preview',
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'CR', name: 'Costa Rica', currency: 'CRC', locale: 'es-CR', timeZone: 'America/Costa_Rica',
    callingCode: '506', fiscalAuthority: 'Ministerio de Hacienda',
    taxId: { label: 'Cédula jurídica', example: '3101123456', pattern: '^\\d{9,12}$', hasCheckDigit: false },
    address: { divisionLabel: 'Provincia', divisions: COSTA_RICAN_PROVINCES, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'Hacienda Factura Electrónica' },
    marketStatus: 'preview',
    dateFormat: 'dd/MM/yyyy', thousandSeparator: '.', decimalSeparator: ',',
  },
  {
    countryCode: 'GT', name: 'Guatemala', currency: 'GTQ', locale: 'es-GT', timeZone: 'America/Guatemala',
    callingCode: '502', fiscalAuthority: 'SAT',
    taxId: { label: 'NIT', example: '1234567-9', pattern: '^\\d{2,12}-?[0-9Kk]$', hasCheckDigit: true },
    address: { divisionLabel: 'Departamento', divisions: GUATEMALAN_DEPARTMENTS, postalCodeLabel: 'Código postal', postalCodePattern: '^\\d{5}$', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'SAT FEL' },
    marketStatus: 'preview',
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'SV', name: 'El Salvador', currency: 'USD', locale: 'es-SV', timeZone: 'America/El_Salvador',
    callingCode: '503', fiscalAuthority: 'Ministerio de Hacienda',
    taxId: { label: 'NIT', example: '0614-123456-001-2', pattern: '^\\d{4}-?\\d{6}-?\\d{3}-?\\d$', hasCheckDigit: false },
    address: { divisionLabel: 'Departamento', divisions: SALVADORAN_DEPARTMENTS, postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: true, regime: 'DTE El Salvador' },
    marketStatus: 'preview',
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'HN', name: 'Honduras', currency: 'HNL', locale: 'es-HN', timeZone: 'America/Tegucigalpa',
    callingCode: '504', fiscalAuthority: 'SAR',
    taxId: { label: 'RTN', example: '08019012345678', pattern: '^\\d{14}$', hasCheckDigit: false },
    address: { divisionLabel: 'Departamento', divisions: HONDURAN_DEPARTMENTS, postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: false, regime: null },
    marketStatus: 'preview',
    dateFormat: 'dd/MM/yyyy', thousandSeparator: ',', decimalSeparator: '.',
  },
  {
    countryCode: 'NI', name: 'Nicaragua', currency: 'NIO', locale: 'es-NI', timeZone: 'America/Managua',
    callingCode: '505', fiscalAuthority: 'DGI',
    taxId: { label: 'RUC', example: 'J0310000012345', pattern: '^[A-Za-z0-9]{14}$', hasCheckDigit: false },
    address: { divisionLabel: 'Departamento', divisions: NICARAGUAN_DEPARTMENTS, postalCodeLabel: 'Código postal', postalCodeRequired: false },
    electronicInvoicing: { required: false, regime: null },
    marketStatus: 'preview',
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

/** The extra fiscal fields that apply to one country and one kind of taxpayer. */
export function fiscalFieldsFor(
  countryCode: string,
  kind?: TaxpayerKindValue,
): readonly FiscalFieldSpec[] {
  const profile = findCountryProfile(countryCode);
  if (!profile?.fiscalFields) return [];
  return profile.fiscalFields.filter(
    (field) => !field.appliesTo || !kind || field.appliesTo.includes(kind),
  );
}

/** The options of a select field that apply to one kind of taxpayer. */
export function fiscalFieldOptionsFor(
  field: FiscalFieldSpec,
  kind?: TaxpayerKindValue,
): readonly FiscalFieldOption[] {
  if (!field.options) return [];
  return field.options.filter(
    (option) => !option.appliesTo || !kind || option.appliesTo.includes(kind),
  );
}

/** One rejected fiscal field, in a shape the API can turn into a validation message. */
export interface FiscalFieldError {
  key: string;
  label: string;
  reason: 'required' | 'unknown_option' | 'bad_format' | 'unexpected';
}

/**
 * Check a country's extra fiscal answers.
 *
 * Total and synchronous, like the tax-id validators and for the same reason: a rule that can pass
 * because a lookup returned nothing is not a rule. Unknown keys are rejected rather than ignored,
 * so a client cannot smuggle arbitrary data into `organizations.fiscal_profile`.
 */
export function validateFiscalFields(
  countryCode: string,
  kind: TaxpayerKindValue | undefined,
  values: Readonly<Record<string, unknown>> = {},
): FiscalFieldError[] {
  const expected = fiscalFieldsFor(countryCode, kind);
  const errors: FiscalFieldError[] = [];
  const known = new Set(expected.map((field) => field.key));

  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      errors.push({ key, label: key, reason: 'unexpected' });
    }
  }

  for (const field of expected) {
    const raw = values[field.key];

    // A multi-valued field accepts an array or a comma-separated string, and every entry has to
    // be a published code — a list where one member is wrong is not "mostly valid", it produces
    // an invoice the authority rejects.
    if (field.multiple) {
      const selected = parseMultiValue(raw);
      if (selected.length === 0) {
        if (field.required) errors.push({ key: field.key, label: field.label, reason: 'required' });
        continue;
      }
      const allowed = fiscalFieldOptionsFor(field, kind);
      const unknown = selected.some((code) => !allowed.some((option) => option.code === code));
      if (unknown) {
        errors.push({ key: field.key, label: field.label, reason: 'unknown_option' });
      }
      continue;
    }

    const value = typeof raw === 'string' ? raw.trim() : '';

    if (!value) {
      if (field.required) errors.push({ key: field.key, label: field.label, reason: 'required' });
      continue;
    }

    if (field.type === 'select') {
      const allowed = fiscalFieldOptionsFor(field, kind);
      if (!allowed.some((option) => option.code === value)) {
        errors.push({ key: field.key, label: field.label, reason: 'unknown_option' });
      }
      continue;
    }

    if (field.pattern && !new RegExp(`^(?:${field.pattern.replace(/^\^|\$$/g, '')})$`).test(value)) {
      errors.push({ key: field.key, label: field.label, reason: 'bad_format' });
    }
  }

  return errors;
}

/** Keep only the answers the country actually asks for, trimmed. Never store what was not asked. */
export function normalizeFiscalFields(
  countryCode: string,
  kind: TaxpayerKindValue | undefined,
  values: Readonly<Record<string, unknown>> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fiscalFieldsFor(countryCode, kind)) {
    const raw = values[field.key];
    if (field.multiple) {
      const selected = parseMultiValue(raw);
      // Stored comma-separated, de-duplicated and in a stable order, so two tenants that chose
      // the same responsibilities in a different order hold the same value.
      if (selected.length) result[field.key] = [...new Set(selected)].sort().join(',');
      continue;
    }
    if (typeof raw === 'string' && raw.trim()) result[field.key] = raw.trim();
  }
  return result;
}

/**
 * Read a multi-valued fiscal answer from whatever shape it arrived in.
 *
 * The signup form posts an array; a value already stored is a comma-separated string. Both are
 * accepted so the round-trip through the database does not change what the field means.
 */
function parseMultiValue(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0);
}
