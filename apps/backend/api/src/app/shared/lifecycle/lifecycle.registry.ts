import { Injectable, Logger } from '@nestjs/common';

import { DocumentLifecycle } from '@virteex/shared/types';

/**
 * Los ciclos de vida declarados, por tipo de documento.
 *
 * Mismo patrón que el registro de bandejas y por la misma razón: el módulo dueño del documento es
 * el único que sabe cómo vive, se apunta solo, y quien lo muestra no conoce a ninguno. Un
 * documento cuyo módulo no declare su vida simplemente no enseña la tira de etapas — que es
 * honesto: no se inventa un recorrido que nadie escribió.
 */
@Injectable()
export class LifecycleRegistry {
  private readonly logger = new Logger(LifecycleRegistry.name);
  private readonly lifecycles = new Map<string, DocumentLifecycle>();

  register(lifecycle: DocumentLifecycle): void {
    if (this.lifecycles.has(lifecycle.documentType)) {
      this.logger.warn(
        { event: 'duplicate_lifecycle', documentType: lifecycle.documentType },
        `Ya había un ciclo de vida para "${lifecycle.documentType}"; se conserva el primero.`,
      );
      return;
    }
    this.lifecycles.set(lifecycle.documentType, lifecycle);
  }

  get(documentType: string): DocumentLifecycle | null {
    return this.lifecycles.get(documentType) ?? null;
  }

  all(): DocumentLifecycle[] {
    return [...this.lifecycles.values()];
  }
}
