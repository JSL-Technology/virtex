import { Global, Module } from '@nestjs/common';

import { ModuleInboxRegistry } from './module-inbox.registry';

/**
 * El registro de bandejas, disponible en todo el contenedor.
 *
 * `@Global` porque lo necesitan dos extremos que no se conocen: cada módulo operativo, para
 * apuntarse, y Reportes, para leer la lista. Importarlo explícitamente en los diez obligaría a
 * recordar hacerlo en el once.
 */
@Global()
@Module({
  providers: [ModuleInboxRegistry],
  exports: [ModuleInboxRegistry],
})
export class InboxModule {}
