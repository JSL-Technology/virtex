import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Un solo nombre para la columna de empresa, y la cobertura de RLS al día.
 *
 * ## El agujero que cierra
 *
 * `TenantRowLevelSecurity1789002100000` deriva su lista de tablas de `information_schema` en
 * lugar de llevarla escrita, y su comentario dice que así «no puede desviarse: una tabla añadida
 * más tarde se lee del esquema, no de una lista que alguien tiene que acordarse de actualizar».
 * Eso es verdad del predicado y falso de la cobertura: la consulta se evalúa **una vez**, cuando
 * la migración corre. Todo lo creado después queda fuera.
 *
 * Medido sobre una base con el esquema completo: 86 políticas instaladas y **32 tablas de
 * inquilino sin ninguna**. Dos causas distintas:
 *
 * 1. **18 tablas** cuya `organization_id` era NULLABLE cuando pasó el barrido —y por eso quedó
 *    excluida a propósito— y que `TenantColumnNotNull1789004700000` volvió obligatoria DESPUÉS:
 *    `warehouses`, `projects`, `timesheets`, `purchase_orders`, `production_orders`… Hoy son
 *    tablas con empresa obligatoria y sin política.
 * 2. **14 tablas** cuya columna se llama `"organizationId"` en camelCase, porque sus entidades
 *    no declaran `name` y la estrategia de nombres por defecto de TypeORM la escribe así. El
 *    barrido busca `organization_id`, de modo que esas tablas nunca fueron candidatas —ni lo
 *    serán— y el verificador de cobertura tampoco las ve.
 *
 * ## Por qué renombrar en vez de aceptar los dos nombres
 *
 * Escribir políticas que acepten cualquiera de las dos grafías resuelve el agujero de hoy y
 * crea una segunda regla que hay que recordar: la próxima tabla podría llamarla de una tercera
 * forma. Con un solo nombre, el invariante se comprueba con una consulta y no admite excepciones.
 *
 * El radio del cambio es pequeño y se midió antes de decidirlo: ninguna consulta SQL del código
 * nombra `"organizationId"` —solo lo hacían las migraciones— y las entidades pasan a declarar
 * `name: 'organization_id'`. `npm run check:schema-drift` prueba que entidades y esquema coinciden.
 *
 * ## Qué queda fuera, y dicho en voz alta
 *
 * Las tablas cuya `organization_id` sigue siendo NULLABLE se excluyen igual que antes: una
 * columna de empresa opcional significa que la tabla guarda filas que no son de ningún inquilino
 * —un rol del sistema, una persona que aún no ha entrado en ninguna empresa—, y quién puede
 * verlas es una pregunta sobre el modelo de datos, no algo que una política pueda responder.
 * La diferencia es que ahora el verificador las enumera en vez de callarlas.
 */
export class TenantColumnNameAndRlsCoverage1789006000000 implements MigrationInterface {
  name = 'TenantColumnNameAndRlsCoverage1789006000000';

  /**
   * El predicado de una tabla, derivado del tipo REAL de su columna.
   *
   * Diez tablas guardan la empresa como `character varying` y el resto como `uuid`. El molde es
   * el de la migración original a propósito: dos políticas con el mismo nombre y distinta forma
   * serían peor que ninguna.
   */
  private async predicate(q: QueryRunner, table: string): Promise<string> {
    const rows: Array<{ data_type: string }> = await q.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'organization_id'`,
      [table],
    );
    // NULLIF: al liberar una conexión el ajuste se resetea, y '' no es un uuid. Ausente y vacío
    // tienen que significar lo mismo —ningún inquilino, por tanto ninguna fila—.
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    return rows[0]?.data_type === 'uuid'
      ? `organization_id = ${setting}::uuid`
      : `organization_id = ${setting}`;
  }

  public async up(q: QueryRunner): Promise<void> {
    // ── 1. Un solo nombre de columna ───────────────────────────────────────────
    const camel: Array<{ table_name: string }> = await q.query(`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'organizationId'
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns o
          WHERE o.table_schema = 'public' AND o.table_name = c.table_name
            AND o.column_name = 'organization_id'
        )
      ORDER BY c.table_name
    `);

    for (const { table_name } of camel) {
      await q.query(`ALTER TABLE "${table_name}" RENAME COLUMN "organizationId" TO "organization_id"`);
    }

    // ── 1-bis. Los nombres derivados del nombre viejo ─────────────────────────
    //
    // TypeORM deriva el nombre de un índice o una clave ajena sin nombre propio de un hash de
    // (tabla, columnas). Al renombrar la columna cambia el hash, así que los tres objetos que
    // lo llevaban quedan con el nombre que corresponde a la grafía antigua y
    // `npm run check:schema-drift` —que compara entidades contra esquema— los denuncia. Se
    // renombran en vez de recrearse: un DROP/CREATE de índice sobre una tabla con datos es un
    // bloqueo de escritura que no hace falta pagar.
    const renombres: Array<[string, string, string]> = [
      ['index', 'IDX_4cdd32414b7850ec5ec4395661', 'IDX_ff21adcddb700b492f32cc29c1'],
      ['index', 'IDX_9bb12857bc0a2b519a36512f89', 'IDX_1df772fba00797e941af1694fe'],
      ['constraint', 'FK_83940eef55da7fb7cc987e5ad17', 'FK_3f227ac94f4ea859ff253a68cd4'],
    ];
    for (const [kind, from, to] of renombres) {
      if (kind === 'index') {
        await q.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname = '${from}') THEN
              ALTER INDEX "${from}" RENAME TO "${to}";
            END IF;
          END
          $$;
        `);
      } else {
        await q.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${from}') THEN
              ALTER TABLE "datasheet_books" RENAME CONSTRAINT "${from}" TO "${to}";
            END IF;
          END
          $$;
        `);
      }
    }

    // ── 2. La cobertura, recalculada ───────────────────────────────────────────
    //
    // Idempotente por construcción: solo toca las tablas a las que les falta la política, así
    // que volver a correrla no reescribe las 86 que ya estaban bien.
    const unprotected: Array<{ table_name: string }> = await q.query(`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
        AND c.column_name = 'organization_id'
        AND c.is_nullable = 'NO'
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.tablename = c.table_name AND p.policyname = 'tenant_isolation'
        )
      ORDER BY c.table_name
    `);

    for (const { table_name } of unprotected) {
      const predicate = await this.predicate(q, table_name);
      await q.query(`ALTER TABLE "${table_name}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table_name}"`);
      // USING gobierna lo que se ve; WITH CHECK lo que se puede escribir. Sin el segundo, un
      // inquilino no puede LEER las filas de otro pero sí CREAR una con el id de otro.
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table_name}"
          USING (${predicate})
          WITH CHECK (${predicate})
      `);
    }

    // Las tablas creadas por migraciones posteriores a la original no heredaron los permisos
    // del rol de la aplicación si se crearon antes de que existiera el DEFAULT PRIVILEGES.
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO virtex_app;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  /**
   * La vuelta atrás deshace el renombrado y retira SOLO las políticas que esta migración puso.
   *
   * Se identifican por diferencia contra la lista de la migración original: las que ya existían
   * antes tienen que seguir existiendo después de revertir esta.
   */
  public async down(q: QueryRunner): Promise<void> {
    const added = [
      'approval_policies', 'approval_requests', 'bill_of_material_items', 'bill_of_materials',
      'bin_locations', 'cost_centers', 'datasheet_books', 'departments', 'document_nodes',
      'einvoice_provider_configs', 'landed_costs', 'plugin_metering_records',
      'plugin_tenant_consents', 'pos_sales', 'pos_shifts', 'product_categories',
      'production_orders', 'project_tasks', 'projects', 'purchase_order_lines', 'purchase_orders',
      'purchase_requisition_lines', 'purchase_requisitions', 'recurring_journal_entries',
      'reports', 'supplier_portal_users', 'tax_categories', 'tax_configurations', 'tax_groups',
      'timesheets', 'warehouses', 'work_centers',
    ];
    for (const table of added) {
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    }

    const renamed = [
      'account_period_locks', 'approval_policies', 'approval_requests', 'cost_centers',
      'datasheet_books', 'einvoice_provider_configs', 'plugin_metering_records',
      'plugin_tenant_consents', 'pos_sales', 'pos_shifts', 'recurring_journal_entries',
      'reports', 'tax_categories', 'tax_configurations', 'tax_groups',
    ];
    for (const [kind, from, to] of [
      ['index', 'IDX_ff21adcddb700b492f32cc29c1', 'IDX_4cdd32414b7850ec5ec4395661'],
      ['index', 'IDX_1df772fba00797e941af1694fe', 'IDX_9bb12857bc0a2b519a36512f89'],
      ['constraint', 'FK_3f227ac94f4ea859ff253a68cd4', 'FK_83940eef55da7fb7cc987e5ad17'],
    ] as Array<[string, string, string]>) {
      const existe = kind === 'index'
        ? `SELECT 1 FROM pg_class WHERE relname = '${from}'`
        : `SELECT 1 FROM pg_constraint WHERE conname = '${from}'`;
      const accion = kind === 'index'
        ? `ALTER INDEX "${from}" RENAME TO "${to}"`
        : `ALTER TABLE "datasheet_books" RENAME CONSTRAINT "${from}" TO "${to}"`;
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (${existe}) THEN
            ${accion};
          END IF;
        END
        $$;
      `);
    }

    for (const table of renamed) {
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = '${table}'
              AND column_name = 'organization_id'
          ) THEN
            ALTER TABLE "${table}" RENAME COLUMN "organization_id" TO "organizationId";
          END IF;
        END
        $$;
      `);
    }
  }
}
