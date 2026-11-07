import { DataSource } from 'typeorm';
import { ExclusiveJob, ExclusiveJobsRegistrar, runExclusively } from './exclusive-job';
import { describeWithDb, openTestDataSource } from '../../common/database/testing/integration-db';

/** Two replicas firing the same job at once: one runs it, the other skips. */
describeWithDb('ExclusiveJob', () => {
  let dataSource: DataSource;
  beforeAll(async () => {
    dataSource = await openTestDataSource();
    new ExclusiveJobsRegistrar(dataSource).onModuleInit();
  });
  afterAll(() => dataSource.destroy());

  it('runs a job on one caller at a time, and again once it finished', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let runs = 0;
    const job = async () => {
      runs++;
      await gate;
      return 'done';
    };

    const first = runExclusively('qa-exclusive-job', job);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = await runExclusively('qa-exclusive-job', job);
    expect(second).toBeUndefined();
    release();
    expect(await first).toBe('done');
    expect(runs).toBe(1);

    expect(await runExclusively('qa-exclusive-job', async () => 'again')).toBe('again');
  });

  it('wraps a decorated method, keeping its this and its result', async () => {
    class Worker {
      factor = 3;
      @ExclusiveJob('qa-exclusive-method')
      async work(n: number) {
        return n * this.factor;
      }
    }
    expect(await new Worker().work(5)).toBe(15);
  });

  it('releases the lock when the job throws', async () => {
    await expect(runExclusively('qa-exclusive-throws', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await runExclusively('qa-exclusive-throws', async () => 'ok')).toBe('ok');
  });
});
