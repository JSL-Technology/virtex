/**
 * Quién es dueño de qué, y quién puede depender de quién.
 *
 * ## Por qué este archivo existe
 *
 * La auditoría de septiembre de 2026 (`docs/auditorias/2026-09-SEPARACION-MODULAR-BACKEND-FRONTEND.md`)
 * midió 514 aristas de import entre las carpetas de dominio del backend, 56 ciclos de dos nodos y
 * 57 registros `TypeOrmModule.forFeature` sobre entidades de otro dueño. Ninguna de esas cifras es
 * un accidente: `@nx/enforce-module-boundaries` está instalado y configurado como no-op
 * (`'*' -> ['*']`), y los 68 módulos viven dentro de una sola aplicación Nx, así que la herramienta
 * no podría verlos aunque estuviera configurada.
 *
 * Una frontera que no se puede verificar no es una frontera. Este archivo la declara y
 * `module-boundaries.mjs` la comprueba.
 *
 * ## El grafo es un DAG, y esa es la parte importante
 *
 * `ALLOWED_DEPENDENCIES` no describe el código de hoy: describe el destino. Un módulo operativo
 * (Ventas, Compras, Inventario, RR.HH.) **no depende de Contabilidad**. Publica un hecho de
 * negocio —una factura emitida, un ajuste de existencias, una nómina cerrada— y Contabilidad lo
 * traduce a un asiento. La dirección de la dependencia es Contabilidad → contrato, no operativo →
 * Contabilidad, porque es la única forma en que un módulo operativo se puede extraer a su propio
 * servicio sin llevarse el libro mayor.
 *
 * Los contratos de esos hechos viven en `plataforma`, que por definición no depende de ningún
 * módulo de negocio. Así ni el emisor conoce al consumidor ni el consumidor al emisor.
 *
 * ## `currencies` es datos de referencia, no Finanzas
 *
 * El maestro de monedas y tasas de cambio lo leen Contabilidad, Ventas, Compras, Inventario y
 * Reportes por igual. Si perteneciera a Finanzas, Contabilidad tendría que depender de Finanzas y
 * Finanzas de Contabilidad — un ciclo creado por una decisión de catálogo. Es `plataforma`. La
 * *revaluación* por diferencia cambiaria sí es Contabilidad, y está en `batch-processes`.
 */

/**
 * Carpeta de `apps/backend/api/src/app/` → módulo de negocio dueño.
 *
 * Toda carpeta de primer nivel debe aparecer aquí. `module-boundaries.mjs` falla si encuentra una
 * que no esté mapeada, para que una carpeta nueva no entre sin dueño declarado.
 */
export const MODULE_OF_FOLDER = {
  // ── Registro / Login / Usuarios ───────────────────────────────────────────────────────────────
  auth: 'identidad',
  users: 'identidad',
  roles: 'identidad',
  organizations: 'identidad',
  saas: 'identidad',
  payment: 'identidad',
  geo: 'identidad',

  // ── Contabilidad ──────────────────────────────────────────────────────────────────────────────
  accounting: 'contabilidad',
  'journal-entries': 'contabilidad',
  'chart-of-accounts': 'contabilidad',
  'financial-reporting': 'contabilidad',
  consolidation: 'contabilidad',
  intercompany: 'contabilidad',
  'fixed-assets': 'contabilidad',
  'cost-accounting': 'contabilidad',
  dimensions: 'contabilidad',
  'batch-processes': 'contabilidad',

  // ── Finanzas y Tesorería ──────────────────────────────────────────────────────────────────────
  treasury: 'finanzas',
  reconciliation: 'finanzas',
  budgets: 'finanzas',

  // ── Ventas / Facturación ──────────────────────────────────────────────────────────────────────
  invoices: 'ventas',
  sales: 'ventas',
  customers: 'ventas',
  pos: 'ventas',
  'price-lists': 'ventas',
  einvoicing: 'ventas',
  compliance: 'ventas',
  'customer-service': 'ventas',

  // ── Compras / Proveedores ─────────────────────────────────────────────────────────────────────
  procurement: 'compras',
  'accounts-payable': 'compras',
  suppliers: 'compras',

  // ── Inventario ────────────────────────────────────────────────────────────────────────────────
  inventory: 'inventario',
  'supply-chain': 'inventario',
  'units-of-measure': 'inventario',
  manufacturing: 'inventario',

  // ── RR.HH. / Nómina ───────────────────────────────────────────────────────────────────────────
  payroll: 'rrhh',
  hcm: 'rrhh',
  jurisdictions: 'rrhh',

  // ── Reportes ──────────────────────────────────────────────────────────────────────────────────
  reports: 'reportes',
  'analytical-reporting': 'reportes',
  bi: 'reportes',
  dashboard: 'reportes',
  overview: 'reportes',
  datasheets: 'reportes',
  'my-work': 'reportes',

  // ── Configuración / Administración ────────────────────────────────────────────────────────────
  localization: 'configuracion',
  taxes: 'configuracion',
  extensions: 'configuracion',
  workflows: 'configuracion',
  audit: 'configuracion',
  documents: 'configuracion',
  notifications: 'configuracion',
  'push-notifications': 'configuracion',
  projects: 'configuracion',

  // ── Plataforma (infraestructura; no depende de ningún módulo de negocio) ───────────────────────
  common: 'plataforma',
  shared: 'plataforma',
  contracts: 'plataforma',
  security: 'plataforma',
  i18n: 'plataforma',
  core: 'plataforma',
  cache: 'plataforma',
  queues: 'plataforma',
  websockets: 'plataforma',
  mail: 'plataforma',
  search: 'plataforma',
  health: 'plataforma',
  metrics: 'plataforma',
  storage: 'plataforma',
  config: 'plataforma',
  database: 'plataforma',
  currencies: 'plataforma',
};

/**
 * A qué módulos puede depender cada módulo. **Transitivo no**: lo que no está listado, no se
 * permite, aunque sea alcanzable por otra vía.
 *
 * Leer de arriba abajo es leer el orden de extracción: `plataforma` sale primero, `reportes` es el
 * único que no tiene a nadie encima.
 */
export const ALLOWED_DEPENDENCIES = {
  /** Infraestructura. No conoce ningún dominio — esa es toda su definición. */
  plataforma: [],

  /** Quién es el usuario y a qué organización pertenece. Lo necesita todo el mundo. */
  identidad: ['plataforma'],

  /** Parámetros del tenant: régimen fiscal, impuestos, flujos de aprobación, bitácora. */
  configuracion: ['plataforma', 'identidad'],

  /**
   * El libro mayor. No depende de ningún módulo operativo: **consume sus eventos**, declarados en
   * `plataforma/contracts`. Si esta lista crece con `ventas`, `compras` o `inventario`, la
   * inversión de dependencia se rompió.
   */
  contabilidad: ['plataforma', 'identidad', 'configuracion'],

  /** Conciliar un extracto contra el mayor es una lectura legítima de Contabilidad. */
  finanzas: ['plataforma', 'identidad', 'configuracion', 'contabilidad'],

  inventario: ['plataforma', 'identidad', 'configuracion'],

  /** Ventas descuenta existencias y cobra; contabiliza por evento, no por llamada. */
  ventas: ['plataforma', 'identidad', 'configuracion', 'inventario', 'finanzas'],

  compras: ['plataforma', 'identidad', 'configuracion', 'inventario', 'finanzas'],

  rrhh: ['plataforma', 'identidad', 'configuracion'],

  /**
   * Reportes es dueño de su propio modelo de lectura, alimentado por eventos. No lee las tablas
   * transaccionales de nadie. Es la única forma en que se extrae sin arrastrar el resto.
   */
  reportes: ['plataforma', 'identidad', 'configuracion'],
};

/**
 * Rutas dentro de una carpeta de **dominio** que otro módulo puede importar: la superficie pública.
 *
 * Todo lo demás es interno. `entities/`, `dto/`, `services/`, `strategies/`, `parsers/`,
 * `adapters/` y `repositories/` no son públicos nunca: acoplarse al interior de otro módulo es
 * acoplarse a algo que su dueño tiene derecho a cambiar sin avisar.
 *
 * La regla vive aquí y no en un `index.ts` por carpeta porque los módulos todavía no son paquetes
 * con `exports`; cuando lo sean (fase Nx), este mapa se reemplaza por el `exports` de cada uno.
 *
 * `plataforma` está exenta a propósito: es infraestructura consumida por ruta —
 * `common/pipes/uuid-param.pipe`, `i18n/localized.exception`— y esa es su forma correcta de uso.
 * Lo que sí está mal dentro de `plataforma` (dominio filtrado a `shared/`) lo cubren las reglas de
 * dependencia, no esta.
 */
export const PUBLIC_SURFACE = [
  /^[^/]+\/[^/]+\.module\.ts$/,
  /^[^/]+\/contracts\//,
  /^[^/]+\/ports\//,
  /^[^/]+\/events\//,
];

/** Módulos cuyo interior se puede importar por ruta: solo la infraestructura. */
export const PUBLIC_SURFACE_EXEMPT_TARGETS = ['plataforma'];

/**
 * Familias de reglas que el verificador aplica. El nombre es la clave del baseline, así que
 * cambiarlo invalida el baseline a propósito.
 */
export const RULES = {
  /** Una arista de import hacia un módulo que `ALLOWED_DEPENDENCIES` no permite. */
  FORBIDDEN_DEPENDENCY: 'forbidden-dependency',
  /** A ↔ B: ninguno se extrae sin el otro. */
  MODULE_CYCLE: 'module-cycle',
  /** Import de una ruta interna de otra carpeta (no `PUBLIC_SURFACE`). */
  PRIVATE_IMPORT: 'private-import',
  /** `TypeOrmModule.forFeature([X])` donde `X` pertenece a otro módulo: escribir la tabla ajena. */
  FOREIGN_ENTITY_REGISTRATION: 'foreign-entity-registration',
  /** Pasar un `EntityManager`/`QueryRunner` a un servicio de otro módulo: transacción compartida. */
  CROSS_MODULE_TRANSACTION: 'cross-module-transaction',
  /** `forwardRef` en un `@Module`: un ciclo que el equipo ya reconoció. */
  FORWARD_REF: 'forward-ref',
};
