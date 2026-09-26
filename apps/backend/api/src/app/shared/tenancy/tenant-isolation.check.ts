import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { isDevLikeEnvironment } from '../../auth/auth.config';
import { CLASSIFIED_TABLE_NAMES } from './tenant-table-classification';

/**
 * Comprueba al arrancar que el aislamiento por empresa RIGE de verdad, y se niega a servir si no.
 *
 * ## Por qué esto aborta ahora
 *
 * Antes solo lo decía. El razonamiento escrito aquí era que «hay despliegues legítimos en los que
 * el rol todavía no existe —el primero, antes de la migración que lo crea— y un ERP que no arranca
 * es peor que uno que avisa».
 *
 * La primera mitad sigue siendo cierta y está resuelta abajo: el arranque sin políticas instaladas
 * es exactamente el caso del primer despliegue, y ese sigue permitido, porque las migraciones aún
 * no han corrido. La segunda mitad no se sostiene, y el propio comentario que la acompañaba
 * explicaba por qué: la configuración sin aislamiento «es INDISTINGUIBLE de la correcta desde
 * dentro. Todo funciona, las pruebas pasan, las políticas están en la base, y nadie se entera
 * hasta que alguien ve datos de otra empresa».
 *
 * Un control cuya activación depende de que alguien lea una línea de log es un control opcional. Y
 * un ERP que no arranca es peor que uno que avisa solo mientras el aviso no sea «estoy sirviendo
 * la contabilidad de tus clientes sin separarla».
 *
 * ## Qué se comprueba, exactamente
 *
 * No «¿soy el dueño?», que era la pregunta anterior y dejó de ser la correcta en cuanto las
 * políticas pasaron a `FORCE ROW LEVEL SECURITY`. La pregunta es si las políticas se aplican A
 * ESTA CONEXIÓN, que es falsa en tres casos distintos:
 *
 *  1. el rol es superusuario, o tiene `BYPASSRLS` — las salta siempre, por definición;
 *  2. el rol posee tablas con política donde el `FORCE` no está puesto — el dueño está exento;
 *  3. no hay políticas.
 *
 * Los tres se informan por separado, porque el remedio de cada uno es distinto.
 *
 * ## Dónde no aborta
 *
 * En desarrollo y en pruebas, donde la base suele ser un contenedor con el superusuario `postgres`
 * y exigir el rol acotado convertiría un `docker run postgres` en media tarde de configuración. El
 * aviso se mantiene, y `verify:rls-runtime` prueba el aislamiento de verdad en CI, conectando como
 * `virtex_app`.
 */
@Injectable()
export class TenantIsolationCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantIsolationCheck.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Instaladas no es lo mismo que suficientes.
   *
   * La consulta de `onApplicationBootstrap` cuenta políticas. Contarlas no dice nada sobre si
   * cubren lo que tienen que cubrir: con UNA política de ciento veintiocho tablas de inquilino, el
   * arranque informaba `tenant_isolation_enforcing` y seguía sirviendo.
   *
   * La cobertura se comprobaba solo en CI (`verify:rls`), es decir, contra el esquema de CI. El
   * esquema donde están los datos de los clientes es este, y es el que puede divergir: una
   * migración que no corrió, un `DROP POLICY` manual durante una incidencia, una restauración
   * desde un volcado que no arrastró las políticas. Preguntarlo aquí es preguntarlo donde importa.
   *
   * La clasificación es la misma que usa el verificador —un solo fichero, `tenant-table-classification.ts`—
   * para que no haya dos ideas distintas de qué cuenta como cubierto.
   */
  private async assertCoverage(user: string): Promise<void> {
    const rows: Array<{ table_name: string }> = await this.dataSource.query(`
      SELECT t.table_name
        FROM information_schema.tables t
       WHERE t.table_schema = 'public'
         AND t.table_type = 'BASE TABLE'
         AND NOT EXISTS (
           SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public'
              AND p.tablename = t.table_name
              AND p.policyname = 'tenant_isolation'
         )
       ORDER BY 1
    `);

    const unclassified = rows
      .map((row) => row.table_name)
      .filter((table) => !CLASSIFIED_TABLE_NAMES.has(table));

    if (!unclassified.length) return;

    const detail =
      `${unclassified.length} tabla(s) sin política de aislamiento y sin clasificar: ` +
      `${unclassified.join(', ')}.`;

    if (isDevLikeEnvironment()) {
      this.logger.warn(
        { event: 'tenant_isolation_coverage_incomplete_dev', user, unclassified },
        `${detail} Se tolera en desarrollo; en un despliegue el arranque se detiene.`,
      );
      return;
    }

    this.logger.error(
      { event: 'tenant_isolation_coverage_incomplete', user, unclassified },
      `FATAL: ${detail}`,
    );

    throw new Error(
      `FATAL: tenant isolation does not cover the whole schema. ${detail} ` +
        `Either the migrations have not all run, or the table is new: classify it in ` +
        `shared/tenancy/tenant-table-classification.ts and give it a policy if it holds tenant data.`,
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.dataSource.options.type !== 'postgres') return;

    let row: {
      user: string;
      bypasses: boolean;
      policies: number;
      exempt: number;
    };

    try {
      [row] = (await this.dataSource.query(`
        SELECT
          current_user AS "user",
          -- Un superusuario y un rol con BYPASSRLS saltan las políticas SIEMPRE, con FORCE o sin
          -- él. No es un fallo de configuración necesariamente —una conexión de mantenimiento lo
          -- necesita— pero sí es incompatible con servir peticiones.
          COALESCE(
            (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user),
            false
          ) AS "bypasses",
          (SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'public' AND policyname = 'tenant_isolation') AS "policies",
          -- Tablas con política que este rol POSEE y en las que el FORCE no está puesto: ahí el
          -- dueño sigue exento y la política no le aplica.
          (SELECT count(*)::int
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
             JOIN pg_policies p ON p.tablename = c.relname AND p.policyname = 'tenant_isolation'
            WHERE pg_get_userbyid(c.relowner) = current_user
              AND NOT c.relforcerowsecurity) AS "exempt"
      `)) as [typeof row];
    } catch (error) {
      // No poder comprobarlo no es lo mismo que comprobar que está mal, y tumbar el arranque por
      // una consulta de diagnóstico que falla sería cambiar un riesgo por otro.
      this.logger.warn(
        { event: 'tenant_isolation_check_failed', error: (error as Error).message },
        'No se pudo comprobar si el aislamiento por empresa está en vigor',
      );
      return;
    }

    if (row.policies === 0) {
      // Cero políticas es el caso PEOR de los tres, y era el único que no impedía servir.
      //
      // El motivo declarado —«el primer despliegue, antes de que las migraciones hayan corrido»—
      // es legítimo y sigue atendido, pero como una puerta que alguien abre a propósito y no como
      // el comportamiento por defecto. Tal como estaba, una base sin aislamiento ninguno arrancaba
      // con un `logger.error` que nadie lee, mientras que los dos casos PARCIALES (superusuario,
      // FORCE ausente) sí abortaban. La gravedad iba justo al revés que la consecuencia.
      //
      // Y el propio fichero explica por qué eso importa: esa configuración «es INDISTINGUIBLE de
      // la correcta desde dentro. Todo funciona […] y nadie se entera hasta que alguien ve datos
      // de otra empresa».
      const bootstrapping =
        (process.env['DEPLOY_ALLOW_UNPROTECTED_BOOTSTRAP'] ?? '').toLowerCase() === 'true';

      if (isDevLikeEnvironment() || bootstrapping) {
        this.logger.error(
          { event: 'tenant_isolation_absent', user: row.user, bootstrapping },
          'No hay políticas de aislamiento por empresa en la base de datos. El aislamiento ' +
            'depende por completo del filtro de cada consulta. Ejecuta las migraciones.',
        );
        return;
      }

      this.logger.error(
        { event: 'tenant_isolation_absent_fatal', user: row.user },
        'FATAL: no hay ninguna política de aislamiento por empresa en la base de datos.',
      );

      throw new Error(
        'FATAL: tenant isolation is not installed at all (0 policies). Run the migrations. ' +
          'If this really is the first deploy against an empty database, set ' +
          'DEPLOY_ALLOW_UNPROTECTED_BOOTSTRAP=true for that one boot and remove it afterwards.',
      );
    }

    // Instaladas no es lo mismo que suficientes.
    //
    // La consulta de arriba cuenta políticas; no las compara contra las tablas que deberían
    // tenerlas. Con UNA política de ciento veinte tablas de inquilino, el arranque informaba
    // `tenant_isolation_enforcing` y seguía adelante. La cobertura se comprobaba solo en CI
    // (`verify:rls`), es decir, contra el esquema de CI y no contra el de este despliegue —
    // que es donde están los datos de los clientes.
    await this.assertCoverage(row.user);

    const problems: string[] = [];
    if (row.bypasses) {
      problems.push(
        `el rol "${row.user}" es superusuario o tiene BYPASSRLS, así que ninguna política le aplica`,
      );
    }
    if (row.exempt > 0) {
      problems.push(
        `el rol "${row.user}" posee ${row.exempt} tabla(s) con política donde FORCE ROW LEVEL ` +
          'SECURITY no está puesto, así que ahí está exento',
      );
    }

    if (!problems.length) {
      this.logger.log(
        { event: 'tenant_isolation_enforcing', user: row.user, policies: row.policies },
        `Aislamiento por empresa en vigor: ${row.policies} políticas rigen para "${row.user}".`,
      );
      return;
    }

    const remedy =
      'Conecta la aplicación como el rol `virtex_app` (DB_USERNAME), que no posee ninguna tabla ' +
      'ni tiene BYPASSRLS, y deja el rol privilegiado solo para las migraciones ' +
      '(DB_MIGRATION_USERNAME). Si faltan los FORCE, ejecuta las migraciones.';

    if (isDevLikeEnvironment()) {
      // En desarrollo la base suele ser un contenedor con el superusuario por defecto, y exigir
      // el rol acotado convertiría «docker run postgres» en una tarde de configuración.
      this.logger.warn(
        {
          event: 'tenant_isolation_not_enforcing_dev',
          user: row.user,
          policies: row.policies,
          problems,
        },
        `Las ${row.policies} políticas de aislamiento NO rigen para esta conexión: ` +
          `${problems.join('; ')}. Se tolera en desarrollo. ${remedy}`,
      );
      return;
    }

    // Fuera de desarrollo esto no es un aviso: es la diferencia entre separar la contabilidad de
    // cada cliente y no separarla, y no se distingue desde dentro.
    this.logger.error(
      {
        event: 'tenant_isolation_not_enforcing',
        user: row.user,
        policies: row.policies,
        problems,
      },
      `FATAL: las ${row.policies} políticas de aislamiento por empresa NO rigen para esta ` +
        `conexión: ${problems.join('; ')}.`,
    );

    throw new Error(
      `FATAL: tenant isolation is installed but does not apply to this connection ` +
        `(${problems.join('; ')}). ${remedy}`,
    );
  }
}
