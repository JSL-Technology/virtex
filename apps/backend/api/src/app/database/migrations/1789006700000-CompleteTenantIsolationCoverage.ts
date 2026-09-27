import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cierra la cobertura del aislamiento por empresa, y la ancla donde corresponde.
 *
 * ## Lo que faltaba
 *
 * Las migraciones anteriores derivan su lista de tablas de una pregunta sobre el NOMBRE de una
 * columna: `column_name = 'organization_id' AND is_nullable = 'NO'`. Eso deja fuera dos clases de
 * tabla de inquilino, y ninguna de las dos aparecía en ningún informe — ni el barrido las veía ni
 * el verificador las echaba de menos:
 *
 *  1. **Nueve tablas hijas** que heredan el inquilino de su padre y por tanto no tienen columna
 *     propia. La lista `inherited` de `1789002100000` cubría 23; estas nueve nunca entraron en
 *     ella, y nada comprobaba que la lista estuviera completa. Entre ellas están las existencias
 *     (`stock_items`, `stock_movements`), los pagos a proveedor (`vendor_payment`), las ubicaciones
 *     de almacén (`locations`), las hojas, versiones y permisos de los libros de cálculo, los pasos
 *     de una política de aprobación y el cierre del árbol de valores de dimensión.
 *
 *  2. **`consolidation_maps`**, cuya columna de empresa se llama `parent_organization_id`. Tenía
 *     política, pero atada a `accounts` a través de `subsidiary_account_id` — es decir, al
 *     inquilino de la SUBSIDIARIA. Desde la matriz, que es quien crea y lee el mapeo, esa política
 *     no devuelve nada: el aislamiento estaba puesto sobre la empresa equivocada, lo que dejaba la
 *     función rota en lugar de protegida. Se reancla a `parent_organization_id`, que es el
 *     inquilino al que la fila pertenece de verdad.
 *
 * ## Por qué los predicados se derivan del esquema
 *
 * Mismo molde que `1789002100000`: el tipo de la columna se lee de `information_schema` en lugar
 * de suponerse, porque diez tablas guardan la empresa como `character varying` y el resto como
 * `uuid`, y el cast va siempre sobre el ajuste y nunca sobre la columna —castear la columna
 * anularía el índice que hay detrás de cada consulta que la política toca—.
 *
 * Dos políticas con el mismo nombre y distinta forma serían peor que ninguna, así que esta usa
 * exactamente la misma.
 */
export class CompleteTenantIsolationCoverage1789006700000 implements MigrationInterface {
  name = 'CompleteTenantIsolationCoverage1789006700000';

  /**
   * Las hijas que faltaban, con el padre del que toman su inquilino.
   *
   * Escritas aquí y también en `shared/tenancy/tenant-table-classification.ts`, que es lo que lee
   * el verificador. La migración no puede importar de `app/` —corre bajo `typeorm-ts-node` con su
   * propio tsconfig— así que la lista se repite; el verificador compara ambas y falla si se
   * separan, que es lo que impide que esta copia envejezca.
   */
  private readonly missingChildren: Array<[table: string, parent: string, foreignKey: string]> = [
    ['approval_policy_steps', 'approval_policies', '"policyId"'],
    ['datasheet_permissions', 'datasheet_books', '"bookId"'],
    ['datasheet_sheets', 'datasheet_books', '"bookId"'],
    ['datasheet_versions', 'datasheet_books', '"bookId"'],
    ['dimension_values_closure', 'dimension_values', 'id_descendant'],
    ['locations', 'warehouses', 'warehouse_id'],
    ['stock_items', 'products', 'product_id'],
    ['stock_movements', 'products', 'product_id'],
    ['vendor_payment', 'vendor_bills', 'vendor_bill_id'],
  ];

  /** El ajuste de sesión, leído igual en todas las políticas de este esquema. */
  private readonly setting = `NULLIF(current_setting('app.current_organization', true), '')`;

  private async tenantColumnType(
    q: QueryRunner,
    table: string,
    column: string,
  ): Promise<string | null> {
    const rows: Array<{ data_type: string }> = await q.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return rows[0]?.data_type ?? null;
  }

  /** `<alias.>columna = ajuste[::uuid]`, con el cast decidido por el tipo real de la columna. */
  private async ownedPredicate(
    q: QueryRunner,
    table: string,
    column: string,
    alias?: string,
  ): Promise<string> {
    const type = await this.tenantColumnType(q, table, column);
    const reference = `${alias ? `${alias}.` : ''}"${column}"`;
    return type === 'uuid'
      ? `${reference} = ${this.setting}::uuid`
      : `${reference} = ${this.setting}`;
  }

  private async exists(q: QueryRunner, table: string): Promise<boolean> {
    const rows: Array<{ ok: boolean }> = await q.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1 AND table_type = 'BASE TABLE'
       ) AS ok`,
      [table],
    );
    return Boolean(rows[0]?.ok);
  }

  private async hasColumn(q: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows: Array<{ ok: boolean }> = await q.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS ok`,
      [table, column],
    );
    return Boolean(rows[0]?.ok);
  }

  /**
   * Instala la política y pone el FORCE.
   *
   * `FORCE` no es opcional: sin él el DUEÑO de la tabla está exento, y una migración que instale
   * políticas sin forzarlas produce exactamente la configuración que `TenantIsolationCheck`
   * describe como indistinguible de la correcta desde dentro.
   */
  private async protect(q: QueryRunner, table: string, predicate: string): Promise<void> {
    await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "${table}"
        USING (${predicate})
        WITH CHECK (${predicate})
    `);
  }

  /**
   * El predicado de una hija, resuelto a través de tantos niveles como haga falta.
   *
   * `dimension_values_closure` cuelga de `dimension_values`, que a su vez cuelga de `dimensions`,
   * que es la fila que lleva el inquilino. Encadenar en general y no tratar ese caso aparte es lo
   * que evita que la próxima nieta falle igual — y falló, ruidosamente, con «el padre
   * dimension_values no lleva organization_id», que es como se encontró.
   *
   * Los padres intermedios se buscan primero en la lista de esta migración y después en la de la
   * migración original, porque una hija nueva puede colgar de una hija vieja.
   */
  private async inheritedPredicate(q: QueryRunner, child: string, depth = 0): Promise<string> {
    const link = this.parentOf(child);
    if (!link) {
      throw new Error(
        `RLS: no hay padre declarado para "${child}". Decláralo en esta migración en lugar de ` +
          `dejar la tabla sin aislamiento.`,
      );
    }

    const [parent, foreignKey] = link;
    const column = foreignKey.replace(/"/g, '');

    if (!(await this.hasColumn(q, child, column))) {
      throw new Error(
        `RLS: "${child}"."${column}" no existe, así que "${child}" quedaría sin aislamiento. ` +
          `Corrige el nombre de la columna en esta migración.`,
      );
    }

    const alias = `p${depth}`;
    const inner = (await this.hasColumn(q, parent, 'organization_id'))
      ? await this.ownedPredicate(q, parent, 'organization_id', alias)
      : await this.inheritedPredicate(q, parent, depth + 1);

    const childReference = depth === 0 ? `"${child}"` : `p${depth - 1}`;
    return `EXISTS (SELECT 1 FROM "${parent}" ${alias} WHERE ${alias}.id = ${childReference}.${foreignKey} AND ${inner})`;
  }

  /**
   * El padre de una tabla: primero entre las que añade esta migración, después entre las que ya
   * declaraba `1789002100000`, porque una hija nueva puede colgar de una hija vieja.
   */
  private parentOf(child: string): [parent: string, foreignKey: string] | null {
    const mine = this.missingChildren.find(([table]) => table === child);
    if (mine) return [mine[1], mine[2]];

    const inheritedBefore: Record<string, [string, string]> = {
      dimension_values: ['dimensions', 'dimension_id'],
      journal_entry_lines: ['journal_entries', 'journal_entry_id'],
      accounts_closure: ['accounts', 'id_descendant'],
    };
    return inheritedBefore[child] ?? null;
  }

  public async up(q: QueryRunner): Promise<void> {
    // ── 1. Las nueve hijas que faltaban ────────────────────────────────────────
    for (const [table] of this.missingChildren) {
      if (!(await this.exists(q, table))) {
        throw new Error(
          `RLS: la tabla "${table}" no existe. Corrige la lista de esta migración en lugar de ` +
            `dejar la fila fuera: una entrada equivocada aquí es una tabla sin aislamiento.`,
        );
      }

      await this.protect(q, table, await this.inheritedPredicate(q, table));
    }

    // ── 2. `consolidation_maps`, reanclada a la matriz ────────────────────────
    //
    // La política anterior la ataba al inquilino de la cuenta SUBSIDIARIA, de modo que la matriz
    // —la única que crea y lee estas filas— no veía ninguna. Aislamiento sobre la empresa
    // equivocada: la función quedaba rota, no protegida.
    if (await this.exists(q, 'consolidation_maps')) {
      const predicate = await this.ownedPredicate(q, 'consolidation_maps', 'parent_organization_id');
      await this.protect(q, 'consolidation_maps', predicate);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [table] of this.missingChildren) {
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }

    // `consolidation_maps` vuelve al predicado heredado que tenía antes, no a no tener ninguno:
    // revertir esta migración no debe dejar una tabla menos protegida de lo que la encontró.
    if (await this.exists(q, 'consolidation_maps')) {
      const rows: Array<{ data_type: string }> = await q.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'accounts' AND column_name = 'organization_id'`,
      );
      const inner =
        rows[0]?.data_type === 'uuid'
          ? `p.organization_id = ${this.setting}::uuid`
          : `p.organization_id = ${this.setting}`;
      const predicate =
        `EXISTS (SELECT 1 FROM "accounts" p WHERE p.id = "consolidation_maps".subsidiary_account_id AND ${inner})`;
      await this.protect(q, 'consolidation_maps', predicate);
    }
  }
}
