
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Account } from './entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { BalanceUpdateService } from './balance-update.service';
import { EventsGateway } from '../websockets/events.gateway';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { MergeAccountsDto } from './dto/merge-accounts.dto';
import { Ledger } from '../accounting/entities/ledger.entity';
import { AccountBalance } from './entities/account-balance.entity';
import { LocalizedMessage } from '../i18n/localized-message';


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
    private readonly balanceUpdateService: BalanceUpdateService,
    private readonly eventsGateway: EventsGateway,
    private readonly auditTrailService: AuditTrailService,
  ) {
    super();
  }





  async process(job: Job<MergeAccountsJobData>): Promise<LocalizedMessage> {

    if (job.name !== 'merge-accounts') {
        this.logger.warn(`Job con nombre desconocido recibido: ${job.name}`);
        return { messageKey: 'CHART_OF_ACCOUNTS.JOB_DESCONOCIDO_IGNORADO' };
    }

    const { dto, organizationId, userId } = job.data;
    const { sourceAccountId, destinationAccountId, reason } = dto;

    this.logger.log(`Iniciando trabajo de fusión de cuentas (Job ID: ${job.id}). Origen: ${sourceAccountId}, Destino: ${destinationAccountId}`);
    
    await this.eventsGateway.sendToUser(userId, 'job-status', {
        jobId: job.id,
        status: 'ACTIVE',
        progress: 0,
        messageKey: 'CHART_OF_ACCOUNTS.INICIANDO_FUSION_CUENTAS',
    });

    try {
      await this.dataSource.transaction(async (manager) => {
        const accountRepo = manager.getRepository(Account);

        const [sourceAccount, destAccount] = await Promise.all([
          accountRepo.findOneBy({ id: sourceAccountId, organizationId }),
          accountRepo.findOneBy({ id: destinationAccountId, organizationId }),
        ]);

        if (!sourceAccount || !destAccount) throw new Error('La cuenta de origen o destino ya no existe.');

        await job.updateProgress(10);
        await this.eventsGateway.sendToUser(userId, 'job-status', { jobId: job.id, progress: 10, messageKey: 'CHART_OF_ACCOUNTS.REASIGNANDO_CUENTAS_HIJAS' });
        await manager.update(Account, { parentId: sourceAccountId }, { parentId: destinationAccountId });
        this.logger.log(`Job ${job.id}: Cuentas hijas de ${sourceAccountId} reasignadas a ${destinationAccountId}.`);
        
        await job.updateProgress(30);
        await this.eventsGateway.sendToUser(userId, 'job-status', { jobId: job.id, progress: 30, messageKey: 'CHART_OF_ACCOUNTS.REASIGNANDO_TRANSACCIONES_ESTO_PUEDE_TARDAR' });
        
        let updatedLinesCount = 0;
        
        while (true) {
            const linesToUpdate = await manager.find(JournalEntryLine, { where: { accountId: sourceAccountId }, take: BATCH_SIZE });
            if (linesToUpdate.length === 0) break;
            
            const lineIds = linesToUpdate.map(line => line.id);
            await manager.update(JournalEntryLine, { id: In(lineIds) }, { accountId: destinationAccountId });
            
            updatedLinesCount += linesToUpdate.length;
            this.logger.log(`Job ${job.id}: Procesado lote de ${linesToUpdate.length} transacciones.`);
            
            const progress = 30 + Math.round((updatedLinesCount / (await manager.count(JournalEntryLine, { where: { accountId: sourceAccountId } }) + updatedLinesCount)) * 50);
            await job.updateProgress(progress);
            await this.eventsGateway.sendToUser(userId, 'job-status', { jobId: job.id, progress, message: `Reasignadas ${updatedLinesCount} transacciones...` });
        }
        this.logger.log(`Job ${job.id}: Total de ${updatedLinesCount} líneas de transacción reasignadas.`);

        await job.updateProgress(90);
        await this.eventsGateway.sendToUser(userId, 'job-status', { jobId: job.id, progress: 90, messageKey: 'CHART_OF_ACCOUNTS.DESACTIVANDO_CUENTA_ORIGEN_RECALCULANDO_SALDOS' });
        

        const ledgers = await manager.find(Ledger, { where: { organizationId } });
        for (const ledger of ledgers) {
            const sourceBalance = await this.recalculateBalanceForAccount(manager, sourceAccountId, ledger.id);
            const destBalance = await this.recalculateBalanceForAccount(manager, destinationAccountId, ledger.id);

            await manager.update(AccountBalance, { accountId: sourceAccountId, ledgerId: ledger.id }, { balance: sourceBalance.balance });
            await manager.update(AccountBalance, { accountId: destinationAccountId, ledgerId: ledger.id }, { balance: destBalance.balance });
        }

        sourceAccount.isActive = false;

        if (!sourceAccount.description) {
            sourceAccount.description = {};
        }
        sourceAccount.description['es'] = `(Fusionada en ${destAccount.code} el ${new Date().toISOString()}) ${sourceAccount.description['es'] || ''}`.trim();
        await manager.save(sourceAccount);

        await this.auditTrailService.record(
            userId, 'accounts', sourceAccountId, ActionType.UPDATE,
            { status: 'MERGED', mergedInto: destinationAccountId, reason },
            { status: 'ACTIVE' },
        );
      });
      
      await job.updateProgress(100);
      const completed = {
        messageKey: 'CHART_OF_ACCOUNTS.MERGE_COMPLETED',
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
        jobId: job.id, status: 'FAILED', messageKey: 'CHART_OF_ACCOUNTS.MERGE_FAILED',
      });
      throw error;
    }
  }
  
  private async recalculateBalanceForAccount(manager: EntityManager, accountId: string, ledgerId: string): Promise<{ balance: number }> {
      const result = await manager.getRepository(JournalEntryLine)
          .createQueryBuilder('line')
          .innerJoin('line.valuations', 'valuation')
          .innerJoin('line.journalEntry', 'entry')
          .where('line.accountId = :accountId', { accountId })
          .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
          .andWhere("entry.status = 'POSTED'")
          .select('SUM(valuation.debit - valuation.credit)', 'balance')
          .getRawOne();
      return { balance: parseFloat(result.balance) || 0 };
  }


  async onActive(job: Job) { this.logger.log(`Procesando job ${job.id}`); }
  async onCompleted(job: Job, result: any) { this.logger.log(`Job ${job.id} completado.`); }
  async onFailed(job: Job, err: Error) { this.logger.error(`Job ${job.id} ha fallado: ${err.message}`); }
}