import { Global, Module } from '@nestjs/common';
import { ClosingBlockerRegistry } from './closing-blockers/closing-blocker.registry';

/**
 * Los contratos por los que dos módulos se hablan sin conocerse.
 *
 * ## Qué puede vivir aquí y qué no
 *
 * Solo interfaces, tokens de inyección y registros sin estado de negocio. Nada de entidades, nada
 * de repositorios, ninguna escritura. Esa es la línea que separa esto de `shared/`, que acabó
 * siendo `@Global` **y** dueño de tablas de cinco módulos distintos: un módulo global que además
 * escribe es el módulo con más poder del sistema y no aparece en ningún mapa de dominio.
 *
 * Es `@Global` porque su razón de existir es que el emisor no tenga que importar al receptor. Si
 * Contabilidad tuviera que importar `ContractsModule` y Compras también, no pasaría nada malo; se
 * evita el ruido, no un acoplamiento.
 */
@Global()
@Module({
  providers: [ClosingBlockerRegistry],
  exports: [ClosingBlockerRegistry],
})
export class ContractsModule {}
