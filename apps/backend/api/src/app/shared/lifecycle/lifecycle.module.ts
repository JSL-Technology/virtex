import { Global, Module } from '@nestjs/common';

import { LifecycleController } from './lifecycle.controller';
import { LifecycleRegistry } from './lifecycle.registry';

/** El registro de ciclos de vida, disponible para que cada módulo apunte el suyo. */
@Global()
@Module({
  controllers: [LifecycleController],
  providers: [LifecycleRegistry],
  exports: [LifecycleRegistry],
})
export class LifecycleModule {}
