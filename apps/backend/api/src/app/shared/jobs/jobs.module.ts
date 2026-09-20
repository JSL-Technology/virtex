import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { JobsPanelController } from './jobs-panel.controller';
import { JobsPanelService } from './jobs-panel.service';

/**
 * El panel de trabajos.
 *
 * Registra las colas que muestra. `registerQueue` es idempotente por nombre: el módulo dueño de
 * cada cola la sigue registrando para encolar en ella, y esto solo pide poder LEERLAS.
 */
@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'account-jobs' },
      { name: 'recurring-entries-processor' },
      { name: 'intercompany-jobs' },
    ),
  ],
  controllers: [JobsPanelController],
  providers: [JobsPanelService],
  exports: [JobsPanelService],
})
export class JobsModule {}
