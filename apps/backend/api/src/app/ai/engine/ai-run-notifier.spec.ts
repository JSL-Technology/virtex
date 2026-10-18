import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiRunNotifierService } from './ai-run-notifier.service';
import { AI_RUN_FINDINGS, AiRunFindingsEvent } from '../../contracts/ai-insights/ai-run-findings.contract';

/**
 * The AI announcing what a run found — exactly once, and only when it is news.
 *
 * Every API replica hears the engine finish, and a sweep runs on top: the run is claimed with a
 * conditional UPDATE so that however many of them race, one announcement comes out.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('AiRunNotifierService', () => {
  jest.setTimeout(60_000);
  let dataSource: DataSource;
  let notifier: AiRunNotifierService;
  const emitted: AiRunFindingsEvent[] = [];
  let org: string;
  let warehouse: string;
  let products: string[];

  const run = async (kind: 'FORECAST' | 'ANOMALY', finishedHoursAgo = 0.1): Promise<string> => {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO ai_model_runs (id, organization_id, kind, status, trigger, started_at, finished_at)
       VALUES ($1, $2, $3, 'SUCCEEDED', 'SCHEDULED', now() - $4 * interval '1 hour' - interval '5 minutes',
               now() - $4 * interval '1 hour')`,
      [id, org, kind, finishedHoursAgo],
    );
    return id;
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    const events = new EventEmitter2();
    events.on(AI_RUN_FINDINGS, (event: AiRunFindingsEvent) => emitted.push(event));
    const lock = { runOnce: async (_: string, __: string, work: () => Promise<void>) => (await work(), true) };
    notifier = new AiRunNotifierService(dataSource, events, lock as never);

    org = randomUUID();
    await dataSource.query(`INSERT INTO organizations (id, legal_name, slug) VALUES ($1, 'AI notices', $2)`, [org, `ai-notices-${org.slice(0, 8)}`]);
    warehouse = randomUUID();
    await dataSource.query(`INSERT INTO warehouses (id, organization_id, name) VALUES ($1, $2, 'Central')`, [warehouse, org]);
    products = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of products.entries()) {
      await dataSource.query(`INSERT INTO products (id, organization_id, name, cost, price) VALUES ($1, $2, $3, 5, 9)`, [id, org, `Arroz ${i}`]);
    }
  });

  afterAll(async () => {
    await dataSource?.query(`DELETE FROM organizations WHERE id = $1`, [org]).catch(() => undefined);
    await dataSource?.destroy();
  });

  beforeEach(() => (emitted.length = 0));

  const insight = (runId: string, product: string, status: string, stockout: string | null) =>
    dataSource.query(
      `INSERT INTO ai_inventory_insights (organization_id, run_id, product_id, warehouse_id, status, stockout_date, service_level, model)
       VALUES ($1, $2, $3, $4, $5, $6, 0.95, 'AutoETS')`,
      [org, runId, product, warehouse, status, stockout],
    );

  it('announces stockout risks once, however many replicas race to it', async () => {
    const id = await run('FORECAST');
    await insight(id, products[0], 'STOCKOUT_RISK', '2026-11-20');
    await insight(id, products[1], 'STOCKOUT_RISK', '2026-11-05');

    const results = await Promise.all([1, 2, 3, 4].map(() => notifier.announce(org, id)));

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(emitted).toEqual([
      expect.objectContaining({
        organizationId: org,
        runId: id,
        kind: 'FORECAST',
        stockouts: { count: 2, earliestDate: '2026-11-05', products: ['Arroz 1', 'Arroz 0'] },
      }),
    ]);
    // And the sweep does not announce it again.
    await notifier.sweepAll();
    expect(emitted).toHaveLength(1);
  });

  it('announces only new high-severity anomalies', async () => {
    const id = await run('ANOMALY');
    const anomaly = (severity: string, fingerprint: string, createdHoursAgo = 0) =>
      dataSource.query(
        `INSERT INTO ai_anomalies (organization_id, run_id, detector, category, severity, score, entity_type, occurred_on, fingerprint, created_at)
         VALUES ($1, $2, 'rule.discount', 'sales', $3, 0.9, 'invoice', current_date, $4, now() - make_interval(hours => $5))`,
        [org, id, severity, fingerprint, createdHoursAgo],
      );
    await anomaly('CRITICAL', `a-${id}`);
    await anomaly('HIGH', `b-${id}`);
    await anomaly('LOW', `c-${id}`);
    await anomaly('HIGH', `d-${id}`, 48); // seen in an earlier run, refreshed by this one

    await notifier.announce(org, id);
    expect(emitted).toEqual([expect.objectContaining({ kind: 'ANOMALY', anomalies: { count: 2, critical: 1 } })]);
  });

  it('closes, without announcing, a run with nothing to say or one already superseded', async () => {
    const quiet = await run('FORECAST', 3);
    await insight(quiet, products[2], 'OK', null);
    const superseded = await run('ANOMALY', 30);
    await run('ANOMALY', 1); // a newer anomaly run exists

    expect(await notifier.announce(org, quiet)).toBeNull();
    expect(await notifier.announce(org, superseded)).toBeNull();
    expect(emitted).toEqual([]);
    const [row] = await dataSource.query(`SELECT notified_at FROM ai_model_runs WHERE id = $1`, [quiet]);
    expect(row.notified_at).not.toBeNull();
  });
});
