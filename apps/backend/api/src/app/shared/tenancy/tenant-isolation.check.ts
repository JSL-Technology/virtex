import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Dice en voz alta si el aislamiento por empresa está en vigor o solo instalado.
 *
 * ## Por qué hace falta decirlo
 *
 * `ENABLE ROW LEVEL SECURITY` no se aplica al DUEÑO de la tabla. Mientras la API conecte como el
 * usuario que creó el esquema, las 118 políticas existen y no rigen: el aislamiento vuelve a
 * depender de que ~90 servicios recuerden su `where: { organizationId }`. Y eso ya falló —la
 * auditoría que añadió `verify:tenant-scope` encontró un listado de órdenes de producción que
 * devolvía las de todos los inquilinos a cualquiera autenticado—.
 *
 * Lo peligroso de esa configuración no es que exista: es que es INDISTINGUIBLE de la correcta
 * desde dentro. Todo funciona, las pruebas pasan, las políticas están en la base, y nadie se
 * entera hasta que alguien ve datos de otra empresa.
 *
 * Así que se comprueba al arrancar y se dice. No se aborta: hay despliegues legítimos en los que
 * el rol todavía no existe —el primero, antes de la migración que lo crea— y un ERP que no
 * arranca es peor que uno que avisa. Pero el aviso es un `error`, no un `debug`, porque es una
 * decisión pendiente y no un detalle.
 */
@Injectable()
export class TenantIsolationCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantIsolationCheck.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.dataSource.options.type !== 'postgres') return;

    try {
      const [row] = (await this.dataSource.query(`
        SELECT
          current_user AS "user",
          (SELECT count(*)::int FROM pg_policies WHERE policyname = 'tenant_isolation') AS "policies",
          -- El dueño de CUALQUIER tabla con política basta para saberlo: si la API es dueña de
          -- una, las políticas de esa tabla no le aplican.
          (SELECT count(*)::int
             FROM pg_class c
             JOIN pg_policies p ON p.tablename = c.relname AND p.policyname = 'tenant_isolation'
            WHERE pg_get_userbyid(c.relowner) = current_user) AS "owned"
      `)) as Array<{ user: string; policies: number; owned: number }>;

      if (row.policies === 0) {
        this.logger.error(
          { event: 'tenant_isolation_absent', user: row.user },
          'No hay políticas de aislamiento por empresa en la base de datos. El aislamiento ' +
            'depende por completo del filtro de cada consulta. Ejecuta las migraciones.',
        );
        return;
      }

      if (row.owned > 0) {
        this.logger.error(
          { event: 'tenant_isolation_not_enforcing', user: row.user, policies: row.policies, ownedTables: row.owned },
          `La API conecta como "${row.user}", que es dueño de ${row.owned} de las tablas con ` +
            `política: las ${row.policies} políticas de aislamiento NO rigen para esta conexión. ` +
            'Conecta como el rol `virtex_app` (DB_USERNAME) y deja el dueño solo para las ' +
            'migraciones (DB_MIGRATION_USERNAME).',
        );
        return;
      }

      this.logger.log(
        { event: 'tenant_isolation_enforcing', user: row.user, policies: row.policies },
        `Aislamiento por empresa en vigor: ${row.policies} políticas, conectado como ` +
          `"${row.user}", que no posee ninguna de las tablas.`,
      );
    } catch (error) {
      // Una comprobación de diagnóstico no puede tumbar el arranque.
      this.logger.warn(
        { event: 'tenant_isolation_check_failed', error: (error as Error).message },
        'No se pudo comprobar si el aislamiento por empresa está en vigor',
      );
    }
  }
}
