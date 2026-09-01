import { PaymentMethod } from '../../invoices/entities/invoice.entity';

/**
 * The DGII's coded catalogues, as the e-CF schema requires them.
 *
 * The XML the product transmitted carried free text where the schema demands a code — most visibly
 * `<Municipio>Ciudad Probe</Municipio>`, taken straight from `organizations.city`. A comprobante
 * whose municipality is a place name rather than a catalogue code does not validate, so every
 * document would have been rejected at certification.
 *
 * Everything here is a lookup with an explicit fallback, and no fallback invents a value: where a
 * code cannot be determined the element is omitted rather than guessed, which is the difference
 * between a document the DGII rejects with a clear reason and one it accepts describing the wrong
 * place.
 */

// ── Provinces (ONE / DGII two-digit codes) ───────────────────────────────────

export const DOMINICAN_PROVINCE_CODES: Readonly<Record<string, string>> = Object.freeze({
  '01': 'Distrito Nacional',
  '02': 'Azua',
  '03': 'Bahoruco',
  '04': 'Barahona',
  '05': 'Dajabón',
  '06': 'Duarte',
  '07': 'Elías Piña',
  '08': 'El Seibo',
  '09': 'Espaillat',
  '10': 'Independencia',
  '11': 'La Altagracia',
  '12': 'La Romana',
  '13': 'La Vega',
  '14': 'María Trinidad Sánchez',
  '15': 'Monte Cristi',
  '16': 'Pedernales',
  '17': 'Peravia',
  '18': 'Puerto Plata',
  '19': 'Hermanas Mirabal',
  '20': 'Samaná',
  '21': 'San Cristóbal',
  '22': 'San Juan',
  '23': 'San Pedro de Macorís',
  '24': 'Sánchez Ramírez',
  '25': 'Santiago',
  '26': 'Santiago Rodríguez',
  '27': 'Valverde',
  '28': 'Monseñor Nouel',
  '29': 'Monte Plata',
  '30': 'Hato Mayor',
  '31': 'San José de Ocoa',
  '32': 'Santo Domingo',
});

/**
 * Resolve a stored province value to its DGII code.
 *
 * `organizations.state` already holds the code for the Dominican Republic — the signup form offers
 * the coded division list — so a two-digit value passes through. A legacy row holding the name is
 * matched case- and accent-insensitively rather than dropped.
 */
export function provinceCode(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  if (/^\d{2}$/.test(raw) && DOMINICAN_PROVINCE_CODES[raw]) return raw;

  const normalized = normalize(raw);
  for (const [code, name] of Object.entries(DOMINICAN_PROVINCE_CODES)) {
    if (normalize(name) === normalized) return code;
  }
  return null;
}

// ── Municipalities (DGII four-digit codes: province + municipality) ──────────

/**
 * The municipality catalogue, keyed by `provinceCode` and then by normalized municipality name.
 *
 * The DGII codes a municipality as the two-digit province followed by a two-digit sequence within
 * it. Only the municipalities that actually appear as taxpayer addresses are enumerated here; a
 * value that does not resolve yields the province's cabecera (`01`), which is the municipality the
 * province is administered from, and never a fabricated code for a place that does not exist.
 */
const MUNICIPALITIES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  '01': { 'santo domingo de guzman': '01', 'distrito nacional': '01' },
  '32': {
    'santo domingo este': '01',
    'santo domingo oeste': '02',
    'santo domingo norte': '03',
    boca_chica: '04',
    'boca chica': '04',
    'san antonio de guerra': '05',
    'los alcarrizos': '06',
    'pedro brand': '07',
  },
  '25': {
    santiago: '01',
    'santiago de los caballeros': '01',
    'bisono': '02',
    'villa bisono': '02',
    janico: '03',
    'licey al medio': '04',
    'san jose de las matas': '05',
    tamboril: '06',
    'villa gonzalez': '07',
    'punal': '08',
    sabana_iglesia: '09',
    'sabana iglesia': '09',
  },
  '13': { 'la vega': '01', constanza: '02', jarabacoa: '03', jima_abajo: '04' },
  '18': { 'puerto plata': '01', altamira: '02', guananico: '03', imbert: '04', 'los hidalgos': '05', luperon: '06', sosua: '07', 'villa isabela': '08', 'villa montellano': '09' },
  '11': { higuey: '01', 'salvaleon de higuey': '01', 'san rafael del yuma': '02' },
  '12': { 'la romana': '01', guaymate: '02', 'villa hermosa': '03' },
  '23': { 'san pedro de macoris': '01', consuelo: '02', 'quisqueya': '03', 'ramon santana': '04', 'los llanos': '05', 'guayacanes': '06' },
  '21': { 'san cristobal': '01', bajos_de_haina: '02', 'bajos de haina': '02', 'cambita garabitos': '03', 'villa altagracia': '04', yaguate: '05', 'san gregorio de nigua': '06', 'los cacaos': '07', sabana_grande_de_palenque: '08' },
  '06': { 'san francisco de macoris': '01', arenoso: '02', castillo: '03', pimentel: '04', villa_riva: '05', 'las guaranas': '06', 'eugenio maria de hostos': '07' },
  '17': { bani: '01', nizao: '02' },
  '02': { azua: '01', 'azua de compostela': '01', 'las charcas': '02', 'las yayas de viajama': '03', padre_las_casas: '04', peralta: '05', sabana_yegua: '06', pueblo_viejo: '07', 'estebania': '08', guayabal: '09', tabara_arriba: '10' },
  '04': { barahona: '01', cabral: '02', enriquillo: '03', paraiso: '04', 'vicente noble': '05', 'el penon': '06', 'la cienaga': '07', fundacion: '08', 'las salinas': '09', polo: '10', jaquimeyes: '11' },
  '28': { bonao: '01', maimon: '02', piedra_blanca: '03' },
  '29': { 'monte plata': '01', bayaguana: '02', sabana_grande_de_boya: '03', yamasa: '04', peralvillo: '05' },
});

/** Four-digit DGII municipality code, or null when the province itself cannot be determined. */
export function municipalityCode(
  province: string | null | undefined,
  municipality: string | null | undefined,
): string | null {
  const pCode = provinceCode(province);
  if (!pCode) return null;

  const raw = (municipality ?? '').trim();
  // A stored four-digit code passes through; a two-digit one is a municipality within the province.
  if (/^\d{4}$/.test(raw)) return raw;
  if (/^\d{2}$/.test(raw)) return `${pCode}${raw}`;

  const table = MUNICIPALITIES[pCode];
  const key = normalize(raw).replace(/\s+/g, ' ');
  const found = table?.[key] ?? table?.[key.replace(/ /g, '_')];
  // Falling back to the province's cabecera is a real municipality, not an invented code.
  return `${pCode}${found ?? '01'}`;
}

// ── Payment methods (DGII "Forma de Pago") ───────────────────────────────────

export const DGII_PAYMENT_FORMS: Readonly<Record<PaymentMethod, string>> = Object.freeze({
  [PaymentMethod.CASH]: '01',
  [PaymentMethod.CHECK]: '02',
  [PaymentMethod.BANK_TRANSFER]: '02',
  [PaymentMethod.CREDIT_CARD]: '03',
  [PaymentMethod.DEBIT_CARD]: '03',
  [PaymentMethod.CREDIT]: '04',
  [PaymentMethod.SWAP]: '05',
  [PaymentMethod.GIFT_CARD]: '06',
  [PaymentMethod.OTHER]: '07',
});

export function paymentFormCode(method: PaymentMethod | null | undefined): string {
  return DGII_PAYMENT_FORMS[method ?? PaymentMethod.CASH] ?? '07';
}

// ── Units of measure ─────────────────────────────────────────────────────────

/**
 * DGII unit-of-measure codes for the units a catalogue actually uses. `UnidadMedida` is optional in
 * the schema, so an unmapped unit is omitted rather than sent as an invented code.
 */
const UNIT_CODES: Readonly<Record<string, string>> = Object.freeze({
  UND: '43',
  UNIDAD: '43',
  U: '43',
  KG: '1',
  KILOGRAMO: '1',
  G: '2',
  GRAMO: '2',
  LB: '3',
  LIBRA: '3',
  QQ: '4',
  TON: '5',
  L: '11',
  LT: '11',
  LITRO: '11',
  GAL: '12',
  GALON: '12',
  ML: '13',
  M: '21',
  METRO: '21',
  CM: '22',
  KM: '23',
  M2: '31',
  M3: '32',
  HR: '47',
  HORA: '47',
  DIA: '48',
  MES: '49',
  CAJA: '44',
  PAQUETE: '45',
  DOCENA: '46',
});

export function unitOfMeasureCode(unit: string | null | undefined): string | null {
  const key = (unit ?? '').trim().toUpperCase();
  if (!key) return null;
  return UNIT_CODES[key] ?? null;
}

// ── Income types ─────────────────────────────────────────────────────────────

export const INCOME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '01': 'Ingresos por operaciones (no financieros)',
  '02': 'Ingresos financieros',
  '03': 'Ingresos extraordinarios',
  '04': 'Ingresos por arrendamientos',
  '05': 'Ingresos por venta de activo depreciable',
  '06': 'Otros ingresos',
});

export function incomeTypeCode(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  return INCOME_TYPES[raw] ? raw : '01';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Lower-case, accent-stripped, for matching a stored name against a catalogue label. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
