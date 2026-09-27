/**
 * Every table in `public`, classified — and the classification is the control.
 *
 * ## Why the previous shape could not work
 *
 * Both the migration that installs the isolation policies and the verifier that checks them asked
 * the same question:
 *
 *     WHERE column_name = 'organization_id' AND is_nullable = 'NO'
 *
 * That is a question about a COLUMN NAME, not about whether a table holds one customer's data. It
 * has three blind spots, and all three are occupied:
 *
 *  1. a tenant table whose column is named something else — `consolidation_maps` carries
 *     `parent_organization_id`;
 *  2. a child table that inherits its tenant from its parent and therefore has no tenant column of
 *     its own — there are nine, and the 23 that ARE covered live in a hand-written list in
 *     `1789002100000-TenantRowLevelSecurity.ts` that nothing checks for completeness;
 *  3. a materialised view, which `table_type = 'BASE TABLE'` excludes and PostgreSQL cannot put a
 *     policy on anyway.
 *
 * A table in any of those three is invisible to the policy installer AND to the verifier, so it
 * ships with no isolation and raises no alarm. The repository has already paid for one instance of
 * this exact mechanism: `1789006000000-TenantColumnNameAndRlsCoverage.ts` records "86 políticas
 * instaladas y 32 tablas de inquilino sin ninguna", fixed by renaming the columns — the symptom —
 * while the mechanism that hid them stayed.
 *
 * ## The rule this file replaces it with
 *
 * Every base table in `public` must be in exactly one of four buckets. Three are listed here by
 * name, because a human decided; the fourth is derived, because the database can answer it.
 *
 *   - PROTECTED    — carries a `tenant_isolation` policy. Derived, not listed.
 *   - INHERITED    — gets its tenant through a parent, named below with the column that links them.
 *   - GLOBAL       — genuinely shared by every tenant, named below with why.
 *   - CROSS_TENANT — identity and tenancy plumbing that exists before, above or between tenants.
 *
 * A table that matches none of them fails the build. "Nobody remembered" stops being a silent
 * outcome and becomes a red pipeline — the same move this repository already made for CSRF,
 * entitlement and permissions, applied to the one control it had not reached.
 *
 * Adding a table here is deliberately a little tedious: it is a claim that somebody checked.
 */

/** A child table and the parent row it takes its tenant from. */
export interface InheritedTenantTable {
  readonly table: string;
  readonly parent: string;
  /** The column on `table` that points at `parent.id`. Quoted exactly as it exists in the schema. */
  readonly foreignKey: string;
  readonly why: string;
}

/**
 * Tables whose tenant is their parent's.
 *
 * The first 23 came from `1789002100000-TenantRowLevelSecurity.ts`, which introduced the idea and
 * the list. The nine after them are the ones that list had missed — found by classifying the whole
 * schema instead of the subset a column name selects, which is the point of this file.
 */
export const INHERITED_TENANT_TABLES: readonly InheritedTenantTable[] = [
  // ── Declared by the original RLS migration ──────────────────────────────────
  { table: 'account_hierarchy_versions', parent: 'accounts', foreignKey: '"accountId"', why: 'Versión de una jerarquía de cuentas.' },
  { table: 'account_history', parent: 'accounts', foreignKey: 'account_id', why: 'Historial de una cuenta.' },
  { table: 'account_period_locks', parent: 'accounting_periods', foreignKey: '"periodId"', why: 'Bloqueo de un periodo contable.' },
  { table: 'account_segments', parent: 'accounts', foreignKey: 'account_id', why: 'Segmentos del código de una cuenta.' },
  { table: 'accounts_closure', parent: 'accounts', foreignKey: 'id_descendant', why: 'Cierre transitivo del árbol de cuentas.' },
  { table: 'bank_transactions', parent: 'bank_statements', foreignKey: 'statement_id', why: 'Líneas de un extracto bancario.' },
  { table: 'budget_lines', parent: 'budgets', foreignKey: 'budget_id', why: 'Líneas de un presupuesto.' },
  { table: 'consolidation_maps', parent: 'accounts', foreignKey: 'subsidiary_account_id', why: 'Mapeo de consolidación; ver nota abajo.' },
  { table: 'customer_addresses', parent: 'customers', foreignKey: 'customer_id', why: 'Direcciones de un cliente.' },
  { table: 'customer_contacts', parent: 'customers', foreignKey: 'customer_id', why: 'Contactos de un cliente.' },
  { table: 'customer_payment_lines', parent: 'customer_payments', foreignKey: 'payment_id', why: 'Líneas de un cobro.' },
  { table: 'dimension_rules', parent: 'dimensions', foreignKey: 'dimension_id', why: 'Reglas de una dimensión analítica.' },
  { table: 'dimension_values', parent: 'dimensions', foreignKey: 'dimension_id', why: 'Valores de una dimensión analítica.' },
  { table: 'invoice_line_item', parent: 'invoices', foreignKey: '"invoiceId"', why: 'Líneas de una factura.' },
  { table: 'journal_entry_lines', parent: 'journal_entries', foreignKey: 'journal_entry_id', why: 'Líneas de un asiento.' },
  { table: 'journal_entry_line_valuations', parent: 'journal_entry_lines', foreignKey: 'journal_entry_line_id', why: 'Valoración de una línea de asiento.' },
  { table: 'ledger_mapping_rule_conditions', parent: 'ledger_mapping_rules', foreignKey: 'rule_id', why: 'Condiciones de una regla de mapeo.' },
  { table: 'price_list_items', parent: 'price_lists', foreignKey: 'price_list_id', why: 'Artículos de una lista de precios.' },
  { table: 'proposed_adjustment_evidence', parent: 'proposed_audit_adjustments', foreignKey: 'proposed_adjustment_id', why: 'Evidencia de un ajuste propuesto.' },
  { table: 'quote_lines', parent: 'quotes', foreignKey: 'quote_id', why: 'Líneas de una cotización.' },
  { table: 'reconciliation_match_lines', parent: 'reconciliation_matches', foreignKey: 'match_id', why: 'Líneas de una conciliación.' },
  { table: 'tax_rules', parent: 'taxes', foreignKey: 'tax_id', why: 'Reglas de un impuesto.' },
  { table: 'vendor_bill_line', parent: 'vendor_bills', foreignKey: '"vendorBillId"', why: 'Líneas de una factura de proveedor.' },

  // ── Found by classifying the whole schema ──────────────────────────────────
  //
  // Nueve tablas de inquilino que llevaban desde el principio sin política y sin aparecer en
  // ningún informe: no tienen `organization_id`, así que el barrido no las veía, y no estaban en
  // la lista de arriba, así que tampoco las heredaban. Entre ellas están el inventario
  // (`stock_items`, `stock_movements`) y los pagos a proveedor (`vendor_payment`).
  { table: 'approval_policy_steps', parent: 'approval_policies', foreignKey: '"policyId"', why: 'Pasos de una política de aprobación.' },
  { table: 'datasheet_sheets', parent: 'datasheet_books', foreignKey: '"bookId"', why: 'Hojas de un libro de cálculo.' },
  { table: 'datasheet_versions', parent: 'datasheet_books', foreignKey: '"bookId"', why: 'Versiones de un libro de cálculo.' },
  { table: 'datasheet_permissions', parent: 'datasheet_books', foreignKey: '"bookId"', why: 'Permisos sobre un libro de cálculo.' },
  { table: 'dimension_values_closure', parent: 'dimension_values', foreignKey: 'id_descendant', why: 'Cierre transitivo del árbol de valores de dimensión.' },
  { table: 'locations', parent: 'warehouses', foreignKey: 'warehouse_id', why: 'Ubicaciones dentro de un almacén.' },
  { table: 'stock_items', parent: 'products', foreignKey: 'product_id', why: 'Existencias de un producto.' },
  { table: 'stock_movements', parent: 'products', foreignKey: 'product_id', why: 'Movimientos de existencias de un producto.' },
  { table: 'vendor_payment', parent: 'vendor_bills', foreignKey: 'vendor_bill_id', why: 'Pagos aplicados a una factura de proveedor.' },
];

/** A table with no tenant, and the reason that is correct. */
export interface UnscopedTable {
  readonly table: string;
  readonly why: string;
}

/**
 * Datos compartidos por todos los inquilinos a propósito: hechos sobre el mundo, el catálogo del
 * producto, y la fontanería del propio esquema.
 */
export const GLOBAL_TABLES: readonly UnscopedTable[] = [
  { table: 'coa_templates', why: 'Plantillas de plan contable por región fiscal.' },
  { table: 'currency', why: 'Catálogo de monedas ISO 4217.' },
  { table: 'dim_time', why: 'Dimensión de calendario del cubo analítico.' },
  { table: 'exchange_rate', why: 'Tipos de cambio publicados.' },
  { table: 'fiscal_document_type_definitions', why: 'Tipos de comprobante por régimen fiscal.' },
  { table: 'fiscal_region_tax_templates', why: 'Plantillas de impuesto por región fiscal.' },
  { table: 'fiscal_regions', why: 'Regiones fiscales soportadas.' },
  { table: 'identity_document_types', why: 'Catálogo de tipos de documento de identidad.' },
  { table: 'localization_templates', why: 'Plantillas de localización por país.' },
  { table: 'payroll_income_tax_brackets', why: 'Escalas de retención publicadas por la autoridad.' },
  { table: 'payroll_statutory_contributions', why: 'Contribuciones legales publicadas por la autoridad.' },
  { table: 'payroll_statutory_references', why: 'Referencias legales de nómina.' },
  { table: 'report_definitions', why: 'Definiciones de informe por región fiscal, no por inquilino.' },
  { table: 'saas_plan_features', why: 'Catálogo de planes del producto.' },
  { table: 'saas_plan_limits', why: 'Catálogo de planes del producto.' },
  { table: 'saas_plans', why: 'Catálogo de planes del producto.' },
  { table: 'tax_schemes', why: 'Esquemas de impuesto por región fiscal.' },
  { table: 'tax_templates', why: 'Plantillas de impuesto por región fiscal.' },
  { table: 'unit_of_measure', why: 'Catálogo de unidades de medida; solo símbolo, categoría y clave de traducción.' },

  // El catálogo de extensiones es global POR DISEÑO: una extensión se publica una vez y se ofrece
  // a todos los inquilinos. Quién puede escribir en él lo decide el nivel de permisos de
  // plataforma (`security/platform-permissions.ts`), no una política de fila.
  { table: 'plugins', why: 'Catálogo compartido de extensiones; protegido por permisos de plataforma.' },
  { table: 'plugin_versions', why: 'Catálogo compartido de extensiones; protegido por permisos de plataforma.' },

  // Fontanería.
  { table: 'migrations', why: 'Registro de migraciones de TypeORM.' },
  { table: 'typeorm_metadata', why: 'Metadatos de vistas de TypeORM.' },
  { table: 'scheduled_job_runs', why: 'Cerrojo de trabajos programados del proceso; no lleva datos de negocio.' },
  { table: 'payment_webhook_events', why: 'Idempotencia de webhooks de Stripe: solo un id y su fecha.' },

  // Restos del esquema base a los que no apunta ninguna entidad. Se declaran para que la
  // clasificación sea completa y para que su ausencia de dueño quede escrita en algún sitio.
  { table: 'project', why: 'Tabla huérfana del esquema base; la vigente es `projects`.' },
  { table: 'cost_center', why: 'Tabla huérfana del esquema base; la vigente es `cost_centers`.' },
];

/**
 * Identidad y tenencia: existen ANTES de que haya un inquilino, POR ENCIMA de uno, o ENTRE varios.
 *
 * Una política de inquilino sobre estas o bien no puede evaluarse —el camino de autenticación las
 * lee antes de que `app.current_organization` esté puesto— o bien contradice su razón de ser.
 * Cada una dice cuál de las dos cosas es.
 */
export const CROSS_TENANT_TABLES: readonly UnscopedTable[] = [
  { table: 'organizations', why: 'El registro de inquilinos. Acotarlo por inquilino es circular.' },
  { table: 'organization_subsidiaries', why: 'Relación ENTRE dos inquilinos; la consolidación la necesita desde el padre.' },
  { table: 'organization_group_members', why: 'Relación ENTRE inquilinos de un mismo grupo.' },
  { table: 'intercompany_transactions', why: 'Operación entre dos empresas: lleva `from_organization_id` y `to_organization_id`.' },

  { table: 'users', why: 'Se lee para autenticar, antes de que exista contexto de inquilino. `organization_id` es nullable: una persona puede no pertenecer aún a ninguna empresa.' },
  { table: 'user_security', why: 'Credenciales. Se leen en el login, antes del contexto de inquilino.' },
  { table: 'user_roles', why: 'Asignación de rol; se resuelve al construir el principal, antes del contexto.' },
  { table: 'roles', why: '`organization_id` nullable a propósito: un rol de plataforma no pertenece a ninguna empresa.' },
  { table: 'refresh_tokens', why: 'Sesiones. El refresco ocurre sin contexto de inquilino.' },
  { table: 'passkeys', why: 'Credencial WebAuthn de una persona, no de una empresa.' },
  { table: 'verification_codes', why: 'Códigos de un solo uso emitidos durante la autenticación.' },
  { table: 'pending_registrations', why: 'Un alta en curso: todavía no hay empresa a la que pertenecer.' },
  { table: 'notification', why: 'Notificación dirigida a una PERSONA (`userId`), que puede pertenecer a varias empresas.' },
  { table: 'push_subscription', why: 'Suscripción de un navegador a una persona.' },
  { table: 'audit_logs', why: '`organization_id` nullable: registra también acciones previas a la existencia del inquilino (altas, intentos de login).' },
];

/** Vistas materializadas. PostgreSQL no admite RLS sobre ellas; ver `MATERIALIZED_VIEWS`. */
export interface MaterializedViewClassification {
  readonly view: string;
  /** La columna de inquilino que TODA consulta sobre ella debe filtrar. */
  readonly tenantColumn: string;
  readonly why: string;
}

/**
 * Vistas materializadas con datos de inquilino.
 *
 * PostgreSQL no aplica RLS a una vista materializada: guarda sus propias filas y las políticas de
 * las tablas base no la alcanzan. Así que estas NO pueden tener la red de seguridad que tiene todo
 * lo demás, y su aislamiento depende por completo del `WHERE` de cada consulta.
 *
 * Declararlas aquí es lo que convierte ese hecho en algo revisable en lugar de en un silencio: el
 * verificador comprueba que cada una siga existiendo con su columna de inquilino, y que no haya
 * aparecido una nueva sin que nadie lo decida.
 */
export const MATERIALIZED_VIEWS: readonly MaterializedViewClassification[] = [
  {
    view: 'analytical_report_data',
    tenantColumn: 'organization_id',
    why: 'Cubo analítico. Se consulta solo desde AnalyticalReportingService.query, que filtra por organization_id.',
  },
];

/** Índice por nombre, para las comprobaciones. */
export const CLASSIFIED_TABLE_NAMES: ReadonlySet<string> = new Set([
  ...INHERITED_TENANT_TABLES.map((t) => t.table),
  ...GLOBAL_TABLES.map((t) => t.table),
  ...CROSS_TENANT_TABLES.map((t) => t.table),
]);
