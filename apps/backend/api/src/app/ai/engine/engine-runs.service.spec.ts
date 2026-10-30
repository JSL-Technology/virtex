import { EngineRunsService, RUN_EXPIRED, RUN_NOT_STARTED } from './engine-runs.service';
import { AiModelRun } from '../entities/ai-model-run.entity';

/** CG-22: a run the engine never picked up read «En cola» with a disabled «En curso…» for a day. */
describe('EngineRunsService — runs that can no longer finish', () => {
  const minutes = (n: number) => new Date(Date.now() - n * 60_000);

  function service(queued: Partial<AiModelRun>[], old: Partial<AiModelRun>[]) {
    const saved: AiModelRun[][] = [];
    const repo = {
      find: jest.fn(({ where }) => Promise.resolve(where.status === 'QUEUED' ? queued : old)),
      findOne: jest.fn(() => Promise.resolve(null)),
      save: jest.fn((rows) => {
        saved.push(rows);
        return Promise.resolve(rows);
      }),
    };
    return { runs: new EngineRunsService(repo as never, { add: jest.fn() } as never), saved };
  }

  it('gives up on a run still queued after half an hour, and says the engine never took it', async () => {
    const run = { id: 'r1', status: 'QUEUED', createdAt: minutes(45), error: null } as AiModelRun;
    const { runs, saved } = service([run], []);
    await runs.latest('org', 'FORECAST');
    expect(saved[0]).toEqual([expect.objectContaining({ id: 'r1', status: 'FAILED', error: RUN_NOT_STARTED })]);
  });

  it('gives up on a run that started and never finished, once', async () => {
    const run = { id: 'r2', status: 'RUNNING', createdAt: minutes(400), error: null } as AiModelRun;
    const { runs, saved } = service([], [run]);
    await runs.latest('org', 'ANOMALY');
    expect(saved[0]).toEqual([expect.objectContaining({ id: 'r2', status: 'FAILED', error: RUN_EXPIRED })]);
  });

  it('writes nothing when every run is in time', async () => {
    const { runs, saved } = service([], []);
    await runs.latest('org', 'FORECAST');
    expect(saved).toHaveLength(0);
  });
});
