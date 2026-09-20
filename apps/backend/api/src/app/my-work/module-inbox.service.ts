import { Injectable, Logger } from '@nestjs/common';

import { ModuleInbox } from '../shared/inbox/module-inbox.port';
import { ModuleInboxRegistry } from '../shared/inbox/module-inbox.registry';

/**
 * La bandeja, por módulo.
 *
 * Pregunta a cada módulo por lo suyo y devuelve la lista. No sabe qué es un asiento en borrador ni
 * una factura vencida, y no debe saberlo: eso es de quien lo modela. Lo único que decide aquí es
 * el ORDEN —lo que lleva más tiempo bloqueado primero, en el conjunto— porque esa comparación
 * cruza módulos y ninguno de ellos puede hacerla solo.
 *
 * ## Un módulo caído no vacía la bandeja
 *
 * Si un proveedor falla, se registra y se devuelve su módulo con cuenta cero en lugar de tumbar la
 * bandeja entera. Un número que falta es visiblemente distinto de un número que no existe, y el
 * resto del trabajo pendiente sigue viéndose. Lo contrario —un 500 en la bandeja porque una
 * consulta de un módulo se rompió— deja a la persona sin saber qué tiene que hacer hoy.
 */
@Injectable()
export class ModuleInboxService {
  private readonly logger = new Logger(ModuleInboxService.name);

  constructor(private readonly registry: ModuleInboxRegistry) {}

  async forTenant(organizationId: string, userId: string): Promise<ModuleInbox[]> {
    const answers = await Promise.all(
      this.registry.all().map(async (provider) => {
        try {
          return await provider.pending(organizationId, userId);
        } catch (error) {
          this.logger.error(
            { event: 'module_inbox_failed', moduleId: provider.moduleId, organizationId },
            `La bandeja de ${provider.moduleId} no pudo calcularse: ${(error as Error).message}`,
          );
          return { moduleId: provider.moduleId, count: 0, items: [] };
        }
      }),
    );

    return answers
      .filter((inbox) => inbox.count > 0)
      .sort((a, b) => {
        // Entre dos módulos, va primero el que tiene la cosa más antigua esperando. Ordenar por
        // cuenta pondría arriba al que más ruido hace, no al que más tiempo lleva parado.
        const masViejo = (inbox: ModuleInbox) => inbox.items[0]?.blockedSince ?? '9999';
        return masViejo(a).localeCompare(masViejo(b));
      });
  }
}
