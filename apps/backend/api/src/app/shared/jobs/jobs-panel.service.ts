import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';

import { VISIBLE_QUEUES } from './queue-catalogue';

/** Un trabajo tal como lo ve quien lo lanzó. */
export interface TenantJob {
  id: string;
  queue: string;
  /** El nombre del trabajo dentro de su cola: `merge-accounts`, `post-intercompany`. */
  name: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  /** 0–100 cuando el procesador lo informa; null cuando no. */
  progress: number | null;
  createdAt: string;
  finishedAt: string | null;
  /** El motivo del fallo, tal cual. Un trabajo que falló sin decir por qué no se puede rehacer. */
  failedReason: string | null;
}

/**
 * Los trabajos largos, visibles para quien los lanzó.
 *
 * ## El problema
 *
 * Fusionar cuentas, postear entre empresas o generar asientos recurrentes son operaciones que se
 * encolan: la petición responde de inmediato y el trabajo ocurre después. Sin panel, la única
 * señal que recibe una persona es que la pantalla no cambia. Si el trabajo falla —y estos
 * reintentan tres veces antes de rendirse— nadie se entera: el registro lo recoge, el usuario no.
 *
 * ## Por qué se filtra por inquilino aquí y no por política
 *
 * Los trabajos viven en Redis, no en PostgreSQL, así que las políticas de aislamiento no llegan.
 * El filtro es el `organizationId` que cada trabajo lleva en su carga —el mismo que
 * `queue-tenancy.spec.ts` obliga a llevar para que el procesador pueda establecer su contexto—.
 * Un trabajo sin ese dato no se muestra a nadie, que es la única respuesta segura: mostrarlo a
 * todos sería una fuga y adivinar su dueño sería peor.
 */
@Injectable()
export class JobsPanelService {
  private readonly logger = new Logger(JobsPanelService.name);
  private readonly queues = new Map<string, Queue>();

  constructor(
    @InjectQueue('account-jobs') accountJobs: Queue,
    @InjectQueue('recurring-entries-processor') recurring: Queue,
    @InjectQueue('intercompany-jobs') intercompany: Queue,
  ) {
    this.queues.set('account-jobs', accountJobs);
    this.queues.set('recurring-entries-processor', recurring);
    this.queues.set('intercompany-jobs', intercompany);
  }

  /**
   * Los trabajos de esta empresa, los más recientes primero.
   *
   * Se piden los últimos de cada cola y no todos: el histórico de una cola puede ser enorme y lo
   * que responde a «¿terminó lo que lancé?» son los últimos. Quien necesite el histórico completo
   * lo tiene en la bitácora, que es donde vive lo que hay que auditar.
   */
  async forTenant(organizationId: string, limit = 20): Promise<TenantJob[]> {
    const porCola = await Promise.all(
      VISIBLE_QUEUES.map(async (name) => {
        const queue = this.queues.get(name);
        if (!queue) return [];
        try {
          const jobs = await queue.getJobs(
            ['active', 'waiting', 'delayed', 'completed', 'failed'],
            0,
            limit * 3,
          );
          return Promise.all(
            jobs
              .filter((job) => (job.data as { organizationId?: string })?.organizationId === organizationId)
              .map((job) => this.describe(name, job)),
          );
        } catch (error) {
          // Redis caído no puede dejar sin panel al resto: se anota y se sigue.
          this.logger.warn(
            { event: 'jobs_panel_queue_unreadable', queue: name },
            `No se pudo leer la cola ${name}: ${(error as Error).message}`,
          );
          return [];
        }
      }),
    );

    return porCola
      .flat()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  private async describe(queue: string, job: Job): Promise<TenantJob> {
    let state: TenantJob['state'] = 'unknown';
    try {
      state = (await job.getState()) as TenantJob['state'];
    } catch {
      /* el estado se perdió: `unknown` es más honesto que inventarlo */
    }

    return {
      id: String(job.id),
      queue,
      name: job.name,
      state,
      progress: typeof job.progress === 'number' ? job.progress : null,
      createdAt: new Date(job.timestamp).toISOString(),
      finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      failedReason: job.failedReason ?? null,
    };
  }
}
