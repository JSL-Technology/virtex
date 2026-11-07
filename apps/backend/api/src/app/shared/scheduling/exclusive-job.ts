import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * A scheduled job runs on one replica at a time (audit 2026-10-31, operations).
 *
 * Every API replica runs its own `@nestjs/schedule` scheduler, so with two replicas every `@Cron`
 * fired twice: the month's depreciation, the recurring entries, the exchange-rate fetch, the
 * overdue reminders. Most of them are idempotent at the row level and some are not, and none should
 * do the work twice. `@ExclusiveJob()` wraps the method in a PostgreSQL advisory lock taken on a
 * connection of its own: whichever replica takes it runs, the others skip, and a replica that dies
 * mid-run releases it with its connection.
 *
 * Put it directly under `@Cron(...)` / `@Interval(...)`. `verify:cron-exclusive` refuses a scheduled
 * method without it.
 */
const LOCK_NAMESPACE = 7_301; // the two-key advisory space of scheduled jobs; any stable int4

let dataSource: DataSource | null = null;
const logger = new Logger('ExclusiveJob');

/** Registers the connection the locks are taken on. */
@Injectable()
export class ExclusiveJobsRegistrar implements OnModuleInit {
  constructor(@InjectDataSource() private readonly source: DataSource) {}
  onModuleInit(): void {
    dataSource = this.source;
  }
}

/** Run `job` if no other replica is running the job of this name; otherwise skip and return undefined. */
export async function runExclusively<T>(name: string, job: () => Promise<T>): Promise<T | undefined> {
  // Built by hand (a spec, a script): nothing to coordinate with.
  if (!dataSource?.isInitialized) return job();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked', [LOCK_NAMESPACE, name]);
    if (!locked) {
      logger.debug(`${name}: running on another replica — skipped.`);
      return undefined;
    }
    try {
      return await job();
    } finally {
      await runner.query('SELECT pg_advisory_unlock($1, hashtext($2))', [LOCK_NAMESPACE, name]);
    }
  } finally {
    await runner.release();
  }
}

/** See the file's comment. The name defaults to `Class.method`. */
export function ExclusiveJob(name?: string): MethodDecorator {
  return (target, key, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: unknown[]) => unknown;
    const jobName = name ?? `${(target as { constructor: { name: string } }).constructor.name}.${String(key)}`;
    descriptor.value = function (this: unknown, ...args: unknown[]) {
      return runExclusively(jobName, async () => original.apply(this, args));
    };
    Object.defineProperty(descriptor.value, 'name', { value: original.name });
    return descriptor;
  };
}
