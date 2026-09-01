import { EntityManager, QueryRunner } from 'typeorm';
import { AfterCommitService } from './after-commit.service';

/**
 * The primitive that removed a timing guess from the posting path.
 *
 * Balance updates were enqueued INSIDE the transaction that wrote the journal entry, so a worker on
 * another connection could pick the job up before the commit — a foreign-key violation on the first
 * posting against a new tenant — or after a rollback, updating a balance for an entry that no
 * longer exists. The old mitigation was a two-second delay on the job, which is a guess about how
 * long a transaction takes and says nothing about rollback.
 */
describe('AfterCommitService', () => {
  let service: AfterCommitService;
  let dataSource: { subscribers: unknown[] };

  /** A query runner with just the surface the service touches, plus manual event dispatch. */
  function makeRunner() {
    const runner = {
      data: {} as Record<string, unknown>,
      isTransactionActive: false,
    } as unknown as QueryRunner;

    return {
      runner,
      manager: { queryRunner: runner } as unknown as EntityManager,
      begin() {
        (runner as { isTransactionActive: boolean }).isTransactionActive = true;
        service.afterTransactionStart({ queryRunner: runner } as never);
      },
      /** Mirrors TypeORM: the flag drops only when the OUTERMOST transaction commits. */
      async commit(outermost = true) {
        if (outermost) (runner as { isTransactionActive: boolean }).isTransactionActive = false;
        await service.afterTransactionCommit({ queryRunner: runner } as never);
      },
      rollback(outermost = true) {
        if (outermost) (runner as { isTransactionActive: boolean }).isTransactionActive = false;
        service.afterTransactionRollback({ queryRunner: runner } as never);
      },
    };
  }

  beforeEach(() => {
    dataSource = { subscribers: [] };
    service = new AfterCommitService(dataSource as never);
    service.onModuleInit();
  });

  it('registers itself so TypeORM broadcasts transaction events to it', () => {
    expect(dataSource.subscribers).toContain(service);
    service.onModuleInit();
    expect(dataSource.subscribers.filter((s) => s === service)).toHaveLength(1);
  });

  it('runs immediately when there is no transaction to wait for', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    await service.runAfterCommit({ queryRunner: undefined } as never, 'sin transacción', run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('holds the effect until the transaction commits', async () => {
    const tx = makeRunner();
    const run = jest.fn().mockResolvedValue(undefined);

    tx.begin();
    await service.runAfterCommit(tx.manager, 'saldos', run);
    expect(run).not.toHaveBeenCalled();

    await tx.commit();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never runs the effect of a rolled-back transaction', async () => {
    const tx = makeRunner();
    const run = jest.fn().mockResolvedValue(undefined);

    tx.begin();
    await service.runAfterCommit(tx.manager, 'saldos', run);
    tx.rollback();

    expect(run).not.toHaveBeenCalled();
  });

  it('waits for the OUTERMOST commit, not a released savepoint', async () => {
    const tx = makeRunner();
    const run = jest.fn().mockResolvedValue(undefined);

    tx.begin(); // BEGIN
    tx.begin(); // SAVEPOINT
    await service.runAfterCommit(tx.manager, 'saldos', run);

    await tx.commit(false); // RELEASE SAVEPOINT — nothing is durable yet
    expect(run).not.toHaveBeenCalled();

    await tx.commit(true); // COMMIT
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a savepoint rollback drops only what was registered inside it', async () => {
    const tx = makeRunner();
    const outer = jest.fn().mockResolvedValue(undefined);
    const inner = jest.fn().mockResolvedValue(undefined);

    tx.begin();
    await service.runAfterCommit(tx.manager, 'externo', outer);
    tx.begin();
    await service.runAfterCommit(tx.manager, 'interno', inner);

    tx.rollback(false); // ROLLBACK TO SAVEPOINT
    await tx.commit(true);

    expect(inner).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('a failing effect does not stop the ones after it, nor surface as a commit failure', async () => {
    const tx = makeRunner();
    const boom = jest.fn().mockRejectedValue(new Error('la cola no responde'));
    const after = jest.fn().mockResolvedValue(undefined);

    tx.begin();
    await service.runAfterCommit(tx.manager, 'falla', boom);
    await service.runAfterCommit(tx.manager, 'sigue', after);

    await expect(tx.commit()).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('does not replay effects on a later transaction of the same runner', async () => {
    const tx = makeRunner();
    const run = jest.fn().mockResolvedValue(undefined);

    tx.begin();
    await service.runAfterCommit(tx.manager, 'saldos', run);
    await tx.commit();

    tx.begin();
    await tx.commit();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
