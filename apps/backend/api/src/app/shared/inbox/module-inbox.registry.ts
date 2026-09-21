import { Injectable, Logger } from '@nestjs/common';

import { ModuleInboxPort } from './module-inbox.port';

/**
 * Dónde se apuntan los módulos que tienen trabajo pendiente que mostrar.
 *
 * Cada proveedor se registra a sí mismo al arrancar, en vez de aparecer en una lista central. Eso
 * es lo que hace que la bandeja sea DERIVADA: un módulo nuevo que implemente el puerto aparece sin
 * tocar nada más, y uno que no lo implemente simplemente no sale. Una lista central habría que
 * acordarse de actualizarla, y un invariante que depende de que alguien lo recuerde no es un
 * invariante.
 *
 * También es lo que permite que la dependencia apunte en la dirección correcta: el registro vive
 * en plataforma, así que Contabilidad puede conocerlo sin que Reportes conozca a Contabilidad.
 */
@Injectable()
export class ModuleInboxRegistry {
  private readonly logger = new Logger(ModuleInboxRegistry.name);
  private readonly providers = new Map<string, ModuleInboxPort>();

  register(provider: ModuleInboxPort): void {
    // Por id y no por lista: dos proveedores del mismo módulo serían dos números para la misma
    // insignia del riel, y no habría forma de decir cuál es el bueno.
    if (this.providers.has(provider.moduleId)) {
      this.logger.warn(
        { event: 'duplicate_inbox_provider', moduleId: provider.moduleId },
        `Ya había un proveedor de bandeja para "${provider.moduleId}"; se conserva el primero.`,
      );
      return;
    }
    this.providers.set(provider.moduleId, provider);
  }

  all(): ModuleInboxPort[] {
    return [...this.providers.values()];
  }
}
