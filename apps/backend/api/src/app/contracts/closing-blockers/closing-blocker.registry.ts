import { Injectable, Logger } from '@nestjs/common';
import {
  ClosingBlocker,
  ClosingBlockerProvider,
  ClosingPeriodQuery,
} from './closing-blocker.contract';

/**
 * Dónde se juntan los que pueden impedir un cierre, sin que ninguno conozca a los demás.
 *
 * ## Por qué un registro y no un `multi` provider
 *
 * Angular tiene `multi: true`; Nest no. Las alternativas eran `DiscoveryService` —escaneo por
 * reflexión, que resuelve lo mismo a cambio de que no se pueda leer quién responde sin ejecutar la
 * aplicación— o esto: cada proveedor se registra en su `onModuleInit`, que Nest ejecuta para todos
 * los módulos antes de aceptar la primera petición.
 *
 * Es deliberadamente aburrido. El registro no guarda datos de negocio, no escribe ninguna tabla y
 * no tiene estado más allá de la lista: es un mecanismo de inyección, y por eso puede ser `@Global`
 * sin repetir el problema que `SharedModule` tiene por ser `@Global` **y** dueño de tablas de cinco
 * módulos.
 *
 * ## Un proveedor caído no tumba el cierre
 *
 * El checklist es un diagnóstico. Si Compras no responde, la respuesta correcta es «no se pudo
 * comprobar», no una pantalla en blanco para quien está cerrando el mes. Cada proveedor se ejecuta
 * aislado y su fallo se convierte en una línea sin completar con su propia nota.
 */
@Injectable()
export class ClosingBlockerRegistry {
  private readonly logger = new Logger(ClosingBlockerRegistry.name);
  private readonly providers: ClosingBlockerProvider[] = [];

  /**
   * Alta de un proveedor. Idempotente: un módulo que se inicializa dos veces —lo que ocurre en
   * pruebas que construyen el contenedor varias veces— no duplica sus líneas.
   */
  register(provider: ClosingBlockerProvider): void {
    if (this.providers.some((p) => p.providerName === provider.providerName)) return;
    this.providers.push(provider);
  }

  /** Solo para pruebas: deja el registro como estaba. */
  reset(): void {
    this.providers.length = 0;
  }

  get registeredNames(): readonly string[] {
    return this.providers.map((p) => p.providerName);
  }

  /**
   * Pregunta a todos, en paralelo, y devuelve lo que digan en orden de registro para que el
   * checklist no cambie de orden entre dos cargas.
   */
  async collect(period: ClosingPeriodQuery): Promise<ClosingBlocker[]> {
    const answers = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          return await provider.blockersFor(period);
        } catch (error) {
          this.logger.error(
            `El proveedor de bloqueos de cierre «${provider.providerName}» falló: ${(error as Error).message}`,
          );
          return [
            {
              id: `${provider.providerName}-unavailable`,
              descriptionKey: 'accounting.checklist.items.provider_unavailable',
              params: { provider: provider.providerName },
              isCompleted: false,
              noteKey: 'accounting.checklist.provider_unavailable',
            } satisfies ClosingBlocker,
          ];
        }
      }),
    );

    return answers.flat();
  }
}
