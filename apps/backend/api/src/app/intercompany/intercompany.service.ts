import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { CreateIntercompanyTransactionDto } from './dto/create-intercompany-transaction.dto';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { OrganizationGroupMember } from '../organizations/entities/organization-group-member.entity';
import {
  IntercompanyTransaction,
  IntercompanyTransactionStatus,
} from './entities/intercompany-transaction.entity';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../i18n/localized.exception';
import { convert, roundAmount } from '../common/money';
import { toIsoDate } from '../common/dates';

export const INTERCOMPANY_QUEUE = 'intercompany-jobs';

export interface DestinationEntryJobData {
  intercompanyTransactionId: string;
}

/**
 * Movements between two companies of the same group.
 *
 * ## What this module was
 *
 * Unreachable. `IntercompanyModule` was imported by nothing, so its controller registered no routes
 * and none of the code below had ever run. Underneath that, four defects were waiting:
 *
 * 1. **No authorization of any kind.** The route carried `JwtAuthGuard` and no permission, and
 *    `toOrganizationId` came from the request body with nothing checked about it. Any authenticated
 *    user of any tenant could have a journal entry posted into another company's books by naming
 *    its uuid. Group membership is now a stored fact (`organization_group_members`) and both
 *    companies must belong to the same group.
 * 2. **A silent 1:1 conversion.** `toAmount = amount * (rate?.rate || 1)` — with no rate on file,
 *    1,000,000 DOP arrived as 1,000,000 USD. The rate is resolved through `ExchangeRateResolver`
 *    now, which triangulates and throws rather than inventing a number.
 * 3. **Rates ignored the transaction date.** `order: { date: 'DESC' }` with no upper bound took
 *    today's rate for a back-dated movement.
 * 4. **A dead queue.** The destination entry was enqueued on `intercompany-jobs`, which had no
 *    `@Processor` and was not registered with `BullModule` at all, so it was never posted: every
 *    transaction left the group permanently unbalanced at PENDING.
 *
 * ## Why the destination half is still asynchronous
 *
 * It posts in a different tenant. One database transaction could span both, but a failure in the
 * receiving company — a closed period, a missing intercompany account — would then roll back a
 * movement the sending company has already made and reported. Splitting them makes the gap
 * explicit: the row carries `status` and `failureReason`, `findPending` lists what has not landed,
 * and `postDestinationEntry` is idempotent so a retry cannot double-post.
 */
@Injectable()
export class IntercompanyService {
  private readonly logger = new Logger(IntercompanyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly exchangeRates: ExchangeRateResolver,
    @InjectQueue(INTERCOMPANY_QUEUE)
    private readonly intercompanyQueue: Queue<DestinationEntryJobData>,
  ) {}

  async create(
    dto: CreateIntercompanyTransactionDto,
    fromOrganizationId: string,
    actorUserId: string,
  ): Promise<IntercompanyTransaction> {
    const { toOrganizationId, date, amount, currency, description, fromAccountId, toAccountId } =
      dto;

    if (fromOrganizationId === toOrganizationId) {
      throw new BadRequestError(
        'INTERCOMPANY.TRANSACCIONES_INTERCOMPANIA_DEBEN_SER_ENTRE_ORGANIZACIONES_DIFERENTES',
      );
    }

    const transaction = await this.dataSource.transaction(async (manager) => {
      await this.requireSameGroup(manager, fromOrganizationId, toOrganizationId);

      const [fromOrg, toOrg] = await Promise.all([
        manager.findOneBy(Organization, { id: fromOrganizationId }),
        manager.findOneBy(Organization, { id: toOrganizationId }),
      ]);
      if (!fromOrg || !toOrg) {
        throw new NotFoundError('INTERCOMPANY.ORGANIZACIONES_NO_FUE_ENCONTRADA');
      }

      const [fromSettings, toSettings] = await Promise.all([
        manager.findOneBy(OrganizationSettings, { organizationId: fromOrganizationId }),
        manager.findOneBy(OrganizationSettings, { organizationId: toOrganizationId }),
      ]);
      if (
        !fromSettings?.defaultIntercompanyReceivableAccountId ||
        !toSettings?.defaultIntercompanyPayableAccountId
      ) {
        throw new BadRequestError(
          'INTERCOMPANY.CUENTAS_INTERCOMPANIA_DEFECTO_NO_ESTAN_CONFIGURADAS_AMBAS',
        );
      }

      // Both accounts are re-read under their own tenant. Taking a uuid from the body and posting
      // to it is precisely how the cross-tenant hole worked; the group check above establishes that
      // the two companies belong together, and this establishes that each account belongs to the
      // company it is claimed for.
      await this.requireAccount(manager, fromOrganizationId, fromAccountId);
      await this.requireAccount(manager, toOrganizationId, toAccountId);

      const sourceJournal = await this.requireGeneralJournal(manager, fromOrganizationId);
      await this.requireGeneralJournal(manager, toOrganizationId);

      const sourceLedger = await manager.findOneBy(Ledger, {
        organizationId: fromOrganizationId,
        isDefault: true,
      });
      if (!sourceLedger) {
        throw new BadRequestError('INTERCOMPANY.ORGANIZACION_ORIGEN_SIN_LIBRO_CONTABLE');
      }

      // The destination amount is fixed here, at the transaction's date, and stored. Deriving it
      // later — which is what the previous code did, with a different formula from the one it used
      // inside the transaction — lets the two halves of one movement use two different rates.
      const currencyCode = currency.toUpperCase();
      const destinationCurrency = (toSettings.baseCurrency ?? currencyCode).toUpperCase();
      const rate = await this.exchangeRates.rateFor(
        currencyCode,
        destinationCurrency,
        date,
        manager,
      );
      const destinationAmount = convert(amount, rate);

      const sourceEntry = await this.journalEntriesService.createWithManager(
        manager,
        {
          date: toIsoDate(date),
          description: `Intercompañía (→ ${toOrg.legalName}): ${description}`,
          currencyCode,
          journalId: sourceJournal.id,
          lines: [
            {
              accountId: fromSettings.defaultIntercompanyReceivableAccountId,
              debit: amount,
              credit: 0,
              description: `Cuenta por cobrar a ${toOrg.legalName}`,
              valuations: [{ ledgerId: sourceLedger.id, debit: amount, credit: 0 }],
            },
            {
              accountId: fromAccountId,
              debit: 0,
              credit: amount,
              description: 'Salida de fondos intercompañía',
              valuations: [{ ledgerId: sourceLedger.id, debit: 0, credit: amount }],
            },
          ],
        } satisfies CreateJournalEntryDto,
        fromOrganizationId,
        { actorUserId, systemReason: 'intercompany-source' },
      );

      return manager.save(
        manager.create(IntercompanyTransaction, {
          fromOrganizationId,
          toOrganizationId,
          amount: roundAmount(amount),
          currency: currencyCode,
          currencyCode,
          exchangeRate: rate,
          destinationAmount,
          description,
          transactionDate: new Date(`${toIsoDate(date)}T00:00:00.000Z`),
          fromAccountId,
          toAccountId,
          sourceJournalEntryId: sourceEntry.id,
          status: IntercompanyTransactionStatus.PENDING,
          createdByUserId: actorUserId,
        }),
      );
    });

    await this.intercompanyQueue.add(
      'create-destination-entry',
      { intercompanyTransactionId: transaction.id },
      {
        jobId: `intercompany-${transaction.id}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: 1_000,
      },
    );

    this.logger.log(
      `Transacción intercompañía ${transaction.id} registrada; asiento de destino encolado.`,
    );
    return transaction;
  }

  /**
   * Post the receiving company's half. Called by the worker, and safe to call again.
   *
   * Idempotent on `destinationJournalEntryId`: a retry after a partial failure, or a duplicate job,
   * finds the entry already there and does nothing. Without that a backoff retry would post the
   * receiving entry twice, which is worse than not posting it at all.
   */
  async postDestinationEntry(intercompanyTransactionId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const transaction = await manager.findOneBy(IntercompanyTransaction, {
        id: intercompanyTransactionId,
      });
      if (!transaction) {
        throw new NotFoundError('INTERCOMPANY.TRANSACCION_NO_ENCONTRADA', {
          id: intercompanyTransactionId,
        });
      }
      if (transaction.destinationJournalEntryId) {
        this.logger.debug(
          `La transacción ${transaction.id} ya tiene asiento de destino; se omite.`,
        );
        return;
      }

      const [toOrg, fromOrg, toSettings] = await Promise.all([
        manager.findOneBy(Organization, { id: transaction.toOrganizationId }),
        manager.findOneBy(Organization, { id: transaction.fromOrganizationId }),
        manager.findOneBy(OrganizationSettings, {
          organizationId: transaction.toOrganizationId,
        }),
      ]);
      if (!toOrg || !fromOrg) {
        throw new NotFoundError('INTERCOMPANY.ORGANIZACIONES_NO_FUE_ENCONTRADA');
      }
      if (!toSettings?.defaultIntercompanyPayableAccountId) {
        throw new BadRequestError(
          'INTERCOMPANY.CUENTA_PAGAR_INTERCOMPANIA_DEFECTO_NO_ESTA_CONFIGURADA',
          { toOrganizationId: transaction.toOrganizationId },
        );
      }
      if (!transaction.toAccountId || transaction.destinationAmount === null) {
        throw new BadRequestError('INTERCOMPANY.TRANSACCION_SIN_DATOS_DE_DESTINO');
      }

      const journal = await this.requireGeneralJournal(manager, transaction.toOrganizationId);
      const ledger = await manager.findOneBy(Ledger, {
        organizationId: transaction.toOrganizationId,
        isDefault: true,
      });
      if (!ledger) {
        throw new BadRequestError('INTERCOMPANY.ORGANIZACION_DESTINO_SIN_LIBRO_CONTABLE');
      }

      const amount = transaction.destinationAmount;
      const entry = await this.journalEntriesService.createWithManager(
        manager,
        {
          date: toIsoDate(transaction.transactionDate),
          description: `Intercompañía (← ${fromOrg.legalName}): ${transaction.description}`,
          currencyCode: toSettings.baseCurrency ?? undefined,
          journalId: journal.id,
          lines: [
            {
              accountId: transaction.toAccountId,
              debit: amount,
              credit: 0,
              description: 'Recepción de fondos intercompañía',
              valuations: [{ ledgerId: ledger.id, debit: amount, credit: 0 }],
            },
            {
              accountId: toSettings.defaultIntercompanyPayableAccountId,
              debit: 0,
              credit: amount,
              description: `Cuenta por pagar a ${fromOrg.legalName}`,
              valuations: [{ ledgerId: ledger.id, debit: 0, credit: amount }],
            },
          ],
        } satisfies CreateJournalEntryDto,
        transaction.toOrganizationId,
        { actorUserId: null, systemReason: 'intercompany-destination' },
      );

      transaction.destinationJournalEntryId = entry.id;
      transaction.status = IntercompanyTransactionStatus.COMPLETED;
      transaction.failureReason = null;
      await manager.save(transaction);

      this.logger.log(
        `Transacción intercompañía ${transaction.id} completada: ${entry.entryNumber} en ${toOrg.legalName}.`,
      );
    });
  }

  /** Record why the destination half could not be posted, so a person can find it. */
  async recordFailure(intercompanyTransactionId: string, reason: string): Promise<void> {
    await this.dataSource.getRepository(IntercompanyTransaction).update(
      { id: intercompanyTransactionId, destinationJournalEntryId: undefined },
      { status: IntercompanyTransactionStatus.FAILED, failureReason: reason.slice(0, 2_000) },
    );
  }

  /**
   * Transactions whose other half has not landed — the report that did not exist.
   *
   * Anything here is a group that does not balance right now. Visible from either side, because
   * whoever notices first should be able to act on it.
   */
  findPending(organizationId: string): Promise<IntercompanyTransaction[]> {
    return this.dataSource.getRepository(IntercompanyTransaction).find({
      where: [
        {
          fromOrganizationId: organizationId,
          status: In([
            IntercompanyTransactionStatus.PENDING,
            IntercompanyTransactionStatus.PROCESSING,
            IntercompanyTransactionStatus.FAILED,
          ]),
        },
        {
          toOrganizationId: organizationId,
          status: In([
            IntercompanyTransactionStatus.PENDING,
            IntercompanyTransactionStatus.PROCESSING,
            IntercompanyTransactionStatus.FAILED,
          ]),
        },
      ],
      order: { transactionDate: 'DESC' },
    });
  }

  findAll(organizationId: string): Promise<IntercompanyTransaction[]> {
    return this.dataSource.getRepository(IntercompanyTransaction).find({
      where: [{ fromOrganizationId: organizationId }, { toOrganizationId: organizationId }],
      order: { transactionDate: 'DESC' },
      take: 500,
    });
  }

  /** Re-enqueue a failed destination entry once the reason it failed has been dealt with. */
  async retry(id: string, organizationId: string): Promise<IntercompanyTransaction> {
    const repository = this.dataSource.getRepository(IntercompanyTransaction);
    const transaction = await repository.findOneBy({ id, fromOrganizationId: organizationId });
    if (!transaction) throw new NotFoundError('INTERCOMPANY.TRANSACCION_NO_ENCONTRADA', { id });
    if (transaction.destinationJournalEntryId) {
      throw new BadRequestError('INTERCOMPANY.TRANSACCION_YA_COMPLETADA');
    }

    transaction.status = IntercompanyTransactionStatus.PENDING;
    transaction.failureReason = null;
    const saved = await repository.save(transaction);

    await this.intercompanyQueue.add(
      'create-destination-entry',
      { intercompanyTransactionId: id },
      { jobId: `intercompany-retry-${id}-${Date.now()}`, attempts: 5 },
    );
    return saved;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Both companies must sit in one group, in either direction or under a common parent.
   *
   * This is the whole of the cross-tenant authorization. Without it the operation is "post into
   * whatever tenant the request names", which is what it was.
   */
  private async requireSameGroup(
    manager: EntityManager,
    a: string,
    b: string,
  ): Promise<void> {
    const memberships = await manager.find(OrganizationGroupMember, {
      where: [
        { parentOrganizationId: a, memberOrganizationId: b, isActive: true },
        { parentOrganizationId: b, memberOrganizationId: a, isActive: true },
      ],
    });
    if (memberships.length > 0) return;

    // Siblings: both members of the same parent.
    const asMember = await manager.find(OrganizationGroupMember, {
      where: [
        { memberOrganizationId: a, isActive: true },
        { memberOrganizationId: b, isActive: true },
      ],
    });
    const parentsOfA = new Set(
      asMember.filter((m) => m.memberOrganizationId === a).map((m) => m.parentOrganizationId),
    );
    const shared = asMember.some(
      (m) => m.memberOrganizationId === b && parentsOfA.has(m.parentOrganizationId),
    );
    if (shared) return;

    throw new ForbiddenError('INTERCOMPANY.ORGANIZACIONES_NO_PERTENECEN_AL_MISMO_GRUPO');
  }

  private async requireAccount(
    manager: EntityManager,
    organizationId: string,
    accountId: string,
  ): Promise<Account> {
    const account = await manager.findOneBy(Account, { id: accountId, organizationId });
    if (!account) {
      throw new BadRequestError('INTERCOMPANY.CUENTA_NO_PERTENECE_A_LA_ORGANIZACION', {
        accountId,
      });
    }
    if (!account.isPostable) {
      throw new BadRequestError('INTERCOMPANY.CUENTA_NO_ADMITE_MOVIMIENTOS', { accountId });
    }
    return account;
  }

  private async requireGeneralJournal(
    manager: EntityManager,
    organizationId: string,
  ): Promise<Journal> {
    const journal = await manager.findOneBy(Journal, { organizationId, type: 'GENERAL' });
    if (!journal) {
      throw new BadRequestError('INTERCOMPANY.ORGANIZACION_NO_TIENE_DIARIO_TIPO_GENERAL', {
        organizationId,
      });
    }
    return journal;
  }
}
