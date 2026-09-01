import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntitySubscriberInterface,
  QueryRunner,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  TransactionStartEvent,
} from 'typeorm';

/** Work held until the transaction that produced it is durable. */
interface PendingSideEffect {
  /** Nesting level at which it was registered, so a savepoint rollback drops only its own. */
  depth: number;
  describe: string;
  run: () => Promise<unknown>;
}

interface PendingState {
  depth: number;
  effects: PendingSideEffect[];
}

/** Where the pending list lives on the query runner. `QueryRunner.data` exists for exactly this. */
const SLOT = '__afterCommitSideEffects';

/**
 * Runs a side effect only once the transaction that produced it has COMMITTED.
 *
 * ## The bug this exists to remove
 *
 * A message queue is a different system from the database. Enqueue a job inside a transaction and
 * the worker — a separate process on a separate connection — can pick it up before the transaction
 * commits, so it looks for rows that do not exist yet, or that will never exist because the
 * transaction rolls back. Balance updates were enqueued from inside `_postJournalEntry`, and the
 * first posting against a freshly provisioned tenant failed with a foreign-key violation on
 * `account_balances`: the worker reached for an `accounts` row its own connection could not see.
 *
 * That was papered over with a two-second delay on the job — "long enough that the commit will
 * probably have landed". A delay is a guess about how long a transaction takes: too short under
 * load and the race is back, and it can never address the rollback case, where the job SHOULD never
 * run and instead runs against data that was undone.
 *
 * This is the deterministic form. The side effect is parked on the query runner and released by
 * TypeORM's `AfterTransactionCommit` broadcast, which fires after the `COMMIT` statement returns. A
 * rollback discards it. Outside a transaction it runs immediately, because there is nothing to wait
 * for.
 *
 * ## Nesting
 *
 * TypeORM implements a nested `transaction()` as a SAVEPOINT and still broadcasts a commit event
 * when that savepoint is released — at which point nothing is durable yet. The flush therefore
 * waits for the runner to leave transaction scope entirely (`isTransactionActive === false`), and a
 * savepoint rollback drops only the effects registered inside it. Depth is counted from the
 * transaction events rather than read off the query runner, whose own `transactionDepth` is
 * protected and not part of the public `QueryRunner` contract.
 *
 * ## What it is not
 *
 * It is not a transactional outbox. If the process dies in the window between COMMIT and the
 * enqueue, the side effect is lost — the database stays consistent, but the job never runs. For
 * balance updates that is recoverable by recomputation, which `chart-of-accounts` exposes. Anything
 * that cannot be recomputed from committed state needs a real outbox table, not this.
 */
@Injectable()
export class AfterCommitService implements EntitySubscriberInterface, OnModuleInit {
  private readonly logger = new Logger(AfterCommitService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    // Registered here rather than through `subscribers` in the data source options so it can be a
    // normal injectable, with the rest of the container available to it.
    if (!this.dataSource.subscribers.includes(this)) {
      this.dataSource.subscribers.push(this);
    }
  }

  /**
   * Register work to run after the current transaction commits.
   *
   * `manager` must be the one the caller is writing through — that is how the transaction is
   * identified. A manager from outside any transaction runs the effect immediately, which is
   * correct: there is then no transaction it could be waiting on.
   */
  async runAfterCommit(
    manager: EntityManager,
    describe: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    const queryRunner = manager.queryRunner;

    if (!queryRunner?.isTransactionActive) {
      await run();
      return;
    }

    const state = this.stateOn(queryRunner);
    state.effects.push({ depth: state.depth, describe, run });
  }

  /** TypeORM subscriber hook: a `BEGIN` or a `SAVEPOINT`. */
  afterTransactionStart(event: TransactionStartEvent): void {
    this.stateOn(event.queryRunner).depth += 1;
  }

  /** TypeORM subscriber hook: fires after `COMMIT` returns, or after a savepoint is released. */
  async afterTransactionCommit(event: TransactionCommitEvent): Promise<void> {
    const queryRunner = event.queryRunner;
    const state = this.stateOn(queryRunner);
    state.depth = Math.max(0, state.depth - 1);

    // A released savepoint is not durable: the outer transaction can still roll back. Keep waiting.
    if (queryRunner.isTransactionActive) return;

    for (const effect of this.take(queryRunner)) {
      try {
        await effect.run();
      } catch (error) {
        // The transaction is already durable — a failed side effect must not un-commit it, and
        // throwing here would surface as a commit failure to a caller whose write actually landed.
        this.logger.error(
          `Efecto posterior a la confirmación falló (${effect.describe}): ${(error as Error).message}`,
        );
      }
    }
  }

  /** TypeORM subscriber hook: drops the effects whose writes were undone. */
  afterTransactionRollback(event: TransactionRollbackEvent): void {
    const queryRunner = event.queryRunner;
    const state = this.stateOn(queryRunner);
    state.depth = Math.max(0, state.depth - 1);

    if (!queryRunner.isTransactionActive) {
      this.take(queryRunner);
      return;
    }

    // Savepoint rollback: only what was registered inside it is undone.
    state.effects = state.effects.filter((effect) => effect.depth <= state.depth);
  }

  private stateOn(queryRunner: QueryRunner): PendingState {
    const data = queryRunner.data as Record<string, unknown>;
    const existing = data[SLOT] as PendingState | undefined;
    if (existing) return existing;

    const created: PendingState = { depth: 0, effects: [] };
    data[SLOT] = created;
    return created;
  }

  private take(queryRunner: QueryRunner): PendingSideEffect[] {
    const data = queryRunner.data as Record<string, unknown>;
    const state = data[SLOT] as PendingState | undefined;
    delete data[SLOT];
    return state?.effects ?? [];
  }
}
