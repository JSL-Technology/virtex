import { CallHandler, ExecutionContext } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Observable, firstValueFrom, from, of, switchMap } from 'rxjs';

import { TenantConnectionInterceptor } from './tenant-connection.interceptor';
import { currentOrganizationId, currentTenantStore } from './tenant-context';

const ORGANIZACION = '9a3cb82a-94fc-410b-a7a6-90d0cff8e431';

/**
 * El inquilino tiene que llegar hasta el cuerpo del manejador.
 *
 * ## El defecto que esto fija
 *
 * El interceptor abría el contexto alrededor de la CONSTRUCCIÓN del observable
 * (`runInTenantContext(store, () => next.handle())`) y no de su suscripción. Con interceptores que
 * llaman a `next.handle()` en el acto eso da igual: la suscripción cae dentro de la llamada. Pero
 * el de idempotencia APLAZA —`from(promesa).pipe(switchMap(() => next.handle()))`— y entonces el
 * manejador se ejecutaba en un microtask posterior, sin inquilino en el almacén.
 *
 * La consecuencia no era un error: `DataSource.transaction` dejaba de reconocer la petición, cogía
 * una conexión limpia del pool sin `app.current_organization`, y las políticas de fila no veían
 * NINGUNA fila. Una orden de compra respondía «no se encontró el proveedor» sobre un proveedor que
 * estaba ahí. Afectaba a las 17 rutas con `@Idempotent()`, que son las que mueven dinero:
 * contabilizar un asiento, aprobar y pagar una factura de proveedor, emitir una factura, registrar
 * un cobro, crear una orden, dar de baja un activo, el cierre anual, una transferencia.
 *
 * Reproducido contra la aplicación en marcha antes de arreglarlo: la sonda dentro de la
 * transacción devolvía `current_setting('app.current_organization') = null` y cero filas.
 */
describe('TenantConnectionInterceptor', () => {
  /** Lo que el interceptor le pide a la base de datos, sin base de datos. */
  function fakeDataSource() {
    const ejecutado: string[] = [];
    let liberado = false;
    const manager = { marca: 'manager-del-inquilino' } as unknown as EntityManager;

    const runner = {
      connect: () => Promise.resolve(),
      query: (sql: string) => {
        ejecutado.push(sql.trim().split('\n')[0]);
        return Promise.resolve([]);
      },
      release: () => {
        liberado = true;
        return Promise.resolve();
      },
    };

    const dataSource = {
      createQueryRunner: () => runner,
      createEntityManager: () => manager,
    } as unknown as DataSource;

    return { dataSource, manager, ejecutado, liberado: () => liberado };
  }

  function contexto(user: { organizationId: string } | undefined): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  /** Un interceptor de dentro que llama al manejador en el acto. */
  function manejadorInmediato(visto: { organizationId?: string }): CallHandler {
    return {
      handle: () => {
        visto.organizationId = currentOrganizationId();
        return of('listo');
      },
    };
  }

  /**
   * La forma exacta de `IdempotencyInterceptor`: reclama la clave con una promesa y solo después
   * llama al manejador.
   */
  function manejadorAplazado(visto: {
    organizationId?: string;
    manager?: unknown;
  }): CallHandler {
    return {
      handle: () =>
        from(Promise.resolve('clave-reclamada')).pipe(
          switchMap(() => {
            visto.organizationId = currentOrganizationId();
            visto.manager = currentTenantStore()?.manager;
            return of('listo');
          }),
        ) as Observable<unknown>,
    };
  }

  it('deja el inquilino puesto para un manejador inmediato', async () => {
    const { dataSource } = fakeDataSource();
    const visto: { organizationId?: string } = {};

    await firstValueFrom(
      new TenantConnectionInterceptor(dataSource).intercept(
        contexto({ organizationId: ORGANIZACION }),
        manejadorInmediato(visto),
      ) as Observable<unknown>,
    );

    expect(visto.organizationId).toBe(ORGANIZACION);
  });

  it('deja el inquilino puesto para un manejador que se APLAZA tras una promesa', async () => {
    // Esta es la que estaba en rojo. Sin envolver la suscripción, `visto.organizationId` era
    // `undefined` y el servicio acababa consultando sin inquilino.
    const { dataSource, manager } = fakeDataSource();
    const visto: { organizationId?: string; manager?: unknown } = {};

    await firstValueFrom(
      new TenantConnectionInterceptor(dataSource).intercept(
        contexto({ organizationId: ORGANIZACION }),
        manejadorAplazado(visto),
      ) as Observable<unknown>,
    );

    expect(visto.organizationId).toBe(ORGANIZACION);
    // Y es el manager fijado a ESA conexión, que es lo que hace que la transacción del servicio
    // herede `app.current_organization`.
    expect(visto.manager).toBe(manager);
  });

  it('estampa el inquilino en la conexión y lo retira al terminar', async () => {
    const { dataSource, ejecutado, liberado } = fakeDataSource();

    await firstValueFrom(
      new TenantConnectionInterceptor(dataSource).intercept(
        contexto({ organizationId: ORGANIZACION }),
        manejadorAplazado({}),
      ) as Observable<unknown>,
    );
    // `finalize` programa el RESET; se resuelve en el siguiente microtask.
    await Promise.resolve();
    await Promise.resolve();

    expect(ejecutado[0]).toContain("set_config('app.current_organization'");
    // Dejar el ajuste puesto sería que el siguiente en coger la conexión del pool leyera los datos
    // de otra empresa, que es exactamente lo que las políticas existen para impedir.
    expect(ejecutado).toContain('RESET app.current_organization');
    expect(liberado()).toBe(true);
  });

  it('no abre contexto ni conexión cuando la petición no tiene inquilino', async () => {
    // Iniciar sesión, la sonda de salud, un webhook de Stripe. Tienen que pasar: la autenticación
    // corre antes de que haya una empresa a la que atarse.
    const { dataSource, ejecutado } = fakeDataSource();
    const visto: { organizationId?: string } = {};

    await firstValueFrom(
      new TenantConnectionInterceptor(dataSource).intercept(
        contexto(undefined),
        manejadorInmediato(visto),
      ) as Observable<unknown>,
    );

    expect(visto.organizationId).toBeUndefined();
    expect(ejecutado).toEqual([]);
  });
});
