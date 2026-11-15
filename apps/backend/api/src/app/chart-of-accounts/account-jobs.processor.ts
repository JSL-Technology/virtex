
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Account } from './entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { EventsGateway } from '../websockets/events.gateway';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { MergeAccountsDto } from './dto/merge-accounts.dto';
import { LocalizedMessage } from '../i18n/localized-message';
import { runAsTenantJob } from '../shared/tenancy/tenant-job';
import { JournalEntry, LEDGER_STATUSES } from '../journal-entries/entities/journal-entry.entity';
import { JournalQueryService } from '../journal-entries/services/journal-query.service';
import { LedgerPostingRegistry } from '../contracts/ledger-posting/ledger-posting.contract';
import { fiscalDate, organizationTimeZone } from '../shared/fiscal-clock';
import { roundAmount } from '../common/money';


interface MergeAccountsJobData {
  dto: MergeAccountsDto;
  organizationId: string;
  userId: string;
}

const BATCH_SIZE = 500;

@Processor('account-jobs')
export class AccountJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountJobsProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventsGateway: EventsGateway,
    private readonly auditTrailService: AuditTrailService,
    private readonly journalQuery: JournalQueryService,
    private readonly ledger: LedgerPostingRegistry,
  ) {
    super();
  }





  async process(job: Job<MergeAccountsJobData>): Promise<LocalizedMessage> {
    // The tenant travels in the payload, so the connection this job runs on carries it too.
    // Without that, the row-level policies deny every row and the job "succeeds" having done
    // nothing — a queue that quietly stops working is worse than one that fails.
    return runAsTenantJob(this.dataSource, job.data.organizationId, () => this.runForTenant(job));
  }

  private async runForTenant(job: Job<MergeAccountsJobData>): Promise<LocalizedMessage> {

    if (job.name !== 'merge-accounts') {
        this.logger.warn(`Job con nombre desconocido recibido: ${job.name}`);
        return { messageKey: 'chart_of_accounts.unknown_job_ignored' };
    }

    const { dto, organizationId, userId } = job.data;
    const { sourceAccountId, destinationAccountId, reason } = dto;

    this.logger.log(`Iniciando trabajo de fusión de cuentas (Job ID: ${job.id}). Origen: ${sourceAccountId}, Destino: ${destinationAccountId}`);
    
    await this.eventsGateway.sendToUser(userId, 'job-status', {
        jobId: job.id,
        status: 'ACTIVE',
        progress: 0,
        messageKey: 'chart_of_accounts.starting_account_merge',
    });

    try {
      await this.dataSource.transaction(async (manager) => {
        const accountRepo = manager.getRepository(Account);

        const [sourceAccount, destAccount] = await Promise.all([
          accountRepo.findOneBy({ id: sourceAccountId, organizationId }),
          accountRepo.findOneBy({ id: destinationAccountId, organizationId }),
        ]);

        if (!sourceAccount || !destAccount) throw new Error('La cuenta de origen o destino ya no existe.');

        await this.progress(job, userId, 10, 'chart_of_accounts.reassigning_child_accounts');
        await manager.update(Account, { parentId: sourceAccountId }, { parentId: destinationAccountId });

        // Only what is NOT yet in the ledger. A draft belongs to whoever is still writing it, so
        // repointing it is a correction; a posted line is history and is never rewritten — which is
        // what the immutability triggers say, and what this job used to attempt on every line it
        // found (FIN-COA-02). It did it in batches, got as far as the first posted one, and failed
        // after telling the person the merge had started.
        await this.progress(job, userId, 35, 'chart_of_accounts.reassigning_transactions_may_take_while');
        const moved = await manager
          .createQueryBuilder()
          .update(JournalEntryLine)
          .set({ accountId: destinationAccountId })
          .where('account_id = :sourceAccountId', { sourceAccountId })
          .andWhere(
            `journal_entry_id IN (SELECT id FROM journal_entries WHERE organization_id = :organizationId AND status NOT IN (:...ledgerStatuses))`,
            { organizationId, ledgerStatuses: LEDGER_STATUSES },
          )
          .execute();
        this.logger.log(`Job ${job.id}: ${moved.affected ?? 0} línea(s) sin contabilizar reasignadas.`);

        // The posted balance moves as a dated entry, which is how a ledger moves anything: the
        // source is squared off against the destination for exactly what it carries, so the source
        // reads zero and the destination reads the combined figure. The lines behind both stay
        // where they were posted, and every statement already issued still reads the same.
        //
        // BY DIMENSION COMBINATION, each pair of lines carrying the tags of the balance it moves.
        // One untagged lump would lose the analytical attribution — both cost centres would keep
        // their balances on the retired account while the destination received an unattributed
        // total — and a mandatory dimension rule on either account would refuse the entry. The
        // tags came out of the ledger, so they travel as they are (`tagsFromLedger`).
        await this.progress(job, userId, 60, 'chart_of_accounts.reclassifying_posted_balance');
        const slices = (await this.journalQuery.postedBalanceByDimension(sourceAccountId, organizationId, manager))
          .map((slice) => ({ ...slice, balance: roundAmount(slice.balance) }))
          .filter((slice) => slice.balance !== 0);
        let reclassificationId: string | null = null;
        if (slices.length > 0) {
          const [organization] = await manager.query<Array<{ country: string | null; timezone: string | null }>>(
            `SELECT "country", "timezone" FROM "organizations" WHERE "id" = $1`,
            [organizationId],
          );
          const words = await this.ledger.describeAll(manager, organizationId, {
            description: {
              key: 'accounting.ledger.account_merge_reclassification',
              params: { source: sourceAccount.code, destination: destAccount.code },
            },
          });
          const posted = await this.ledger.post(
            manager,
            organizationId,
            {
              journalCode: 'GENERAL',
              date: fiscalDate(organizationTimeZone(organization)),
              description: words.description,
              lines: slices.flatMap((slice) => {
                const amount = Math.abs(slice.balance);
                const tags = slice.dimensions ? { dimensions: slice.dimensions } : {};
                return [
                  // A net debit on the source is cleared with a credit, and the other way round.
                  { accountId: sourceAccountId, debit: slice.balance < 0 ? amount : 0, credit: slice.balance > 0 ? amount : 0, ...tags },
                  { accountId: destinationAccountId, debit: slice.balance > 0 ? amount : 0, credit: slice.balance < 0 ? amount : 0, ...tags },
                ];
              }),
            },
            {
              actorUserId: userId,
              systemReason: `account-merge:${sourceAccount.code}->${destAccount.code}`,
              // The queue retries three times; the entry is posted once.
              idempotencyKey: `account-merge:${job.id}`,
              module: 'general-ledger',
              tagsFromLedger: true,
            },
          );
          reclassificationId = posted.id;
          this.logger.log(`Job ${job.id}: reclasificación ${posted.id} en ${slices.length} combinación(es) de dimensiones.`);
        }

        await this.progress(job, userId, 90, 'chart_of_accounts.deactivating_source_account_recalculating_balances');

        // Closed, not deleted: its history is still addressable by its own code, which is the point
        // of not rewriting it. Blocked for posting as well, so nothing new lands on it.
        sourceAccount.isActive = false;
        sourceAccount.isBlockedForPosting = true;
        sourceAccount.blockedAt = new Date();
        if (!sourceAccount.description) sourceAccount.description = {};
        const language = Object.keys(sourceAccount.name ?? {})[0] ?? 'es';
        sourceAccount.description[language] =
          `(→ ${destAccount.code}, ${fiscalDate('UTC')}) ${sourceAccount.description[language] || ''}`.trim();
        await manager.save(sourceAccount);

        await this.auditTrailService.record(
          userId,
          'accounts',
          sourceAccountId,
          ActionType.UPDATE,
          { status: 'MERGED', mergedInto: destinationAccountId, reason, reclassificationId, linesMoved: moved.affected ?? 0 },
          { status: 'ACTIVE' },
        );
      });

      await job.updateProgress(100);
      const completed = {
        messageKey: 'chart_of_accounts.merge_completed',
        messageParams: { source: dto.sourceAccountId, destination: dto.destinationAccountId },
      };

      // The socket carries the key too: the browser holds the catalogue and the job may finish
      // long after the request that started it, possibly for a colleague reading in another
      // language. Sending a finished sentence would freeze the language at job-completion time.
      await this.eventsGateway.sendToUser(userId, 'job-status', {
        jobId: job.id, status: 'COMPLETED', progress: 100, ...completed,
      });

      return completed;

    } catch (error) {
      this.logger.error(`Fallo en el trabajo de fusión de cuentas (Job ID: ${job.id}). Razón: ${(error as Error).message}`, (error as Error).stack);
      await this.eventsGateway.sendToUser(userId, 'job-status', {
        // The cause is not translated and not shown as prose: it is whatever threw, and forwarding
        // it verbatim to a browser is how a stack trace or a SQL fragment reaches a customer.
        jobId: job.id, status: 'FAILED', messageKey: 'chart_of_accounts.merge_failed',
      });
      throw error;
    }
  }
  


  /** One line instead of two at every step: update the job and tell the browser. */
  private async progress(job: Job, userId: string, progress: number, messageKey: string): Promise<void> {
    await job.updateProgress(progress);
    await this.eventsGateway.sendToUser(userId, 'job-status', { jobId: job.id, progress, messageKey });
  }

  async onActive(job: Job) { this.logger.log(`Procesando job ${job.id}`); }
  async onCompleted(job: Job, result: any) { this.logger.log(`Job ${job.id} completado.`); }
  async onFailed(job: Job, err: Error) { this.logger.error(`Job ${job.id} ha fallado: ${err.message}`); }
}