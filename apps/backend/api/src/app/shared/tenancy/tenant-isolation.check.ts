import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { isDevLikeEnvironment } from '../../auth/auth.config';

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
      // El primer despliegue, antes de que las migraciones hayan corrido. Es el caso legítimo que
      // justifica no abortar aquí; la aplicación no puede instalar sus propias políticas.
      this.logger.error(
        { event: 'tenant_isolation_absent', user: row.user },
        'No hay políticas de aislamiento por empresa en la base de datos. El aislamiento ' +
          'depende por completo del filtro de cada consulta. Ejecuta las migraciones.',
      );
      return;
    }

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
