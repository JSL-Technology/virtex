import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BankTransfer } from './entities/bank-transfer.entity';
import { BankAccount } from './entities/bank-account.entity';
import { CreateBankTransferDto } from './dto/create-bank-transfer.dto';
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from './dto/bank-account.dto';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { AccountRole } from '../chart-of-accounts/enums/account-enums';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../journal-entries/dto/create-journal-entry.dto';
import {
  BadRequestError,
  NotFoundError,
} from '../i18n/localized.exception';
import {
  AccountBalancesService,
  toIsoDate,
} from '../chart-of-accounts/account-balances.service';
import { convert, roundAmount, sumAmounts, toCents } from '../common/money';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';

export interface CashPositionRow {
  bankAccountId: string;
  name: string;
  bankName: string | null;
  /** Masked: only the last four digits leave the server. */
  accountNumberMasked: string | null;
  currencyCode: string;
  glAccountId: string;
  /** Balance of the control account, in the books' currency. */
  balanceInBaseCurrency: number;
}

export interface CashPosition {
  asOfDate: string;
  baseCurrency: string;
  accounts: CashPositionRow[];
  total: number;
}

/** `1234567890` → `••••7890`. Enough to recognise the account, not enough to use it. */
function maskAccountNumber(accountNumber: string | null): string | null {
  if (!accountNumber) return null;
  const digits = accountNumber.replace(/\s+/g, '');
  if (digits.length <= 4) return '••••';
  return `••••${digits.slice(-4)}`;
}

/**
 * Treasury: the tenant's own accounts, and movements between them.
 *
 * ## What this module was
 *
 * One endpoint, `POST /treasury/bank-transfers`, taking two **chart-of-accounts** ids and an
 * amount. There was no bank account entity at all — no bank, no account number, no currency of its
 * own, no opening balance — so there was nothing to hold a cash position, nothing for a bank
 * statement to belong to, and no way to distinguish a USD account from a DOP one when both post to
 * the same control account. The route also carried no permission, so any authenticated member of
 * the tenant could move money between ledger accounts and generate the entry for it.
 *
 * It would not have run either: `transfer.date.toISOString()` was called on a value that arrives
 * from the DTO as a `YYYY-MM-DD` string, which has no such method.
 */
@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);

  constructor(
    @InjectRepository(BankAccount)
    private readonly bankAccountRepository: Repository<BankAccount>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly balances: AccountBalancesService,
    private readonly exchangeRates: ExchangeRateResolver,
    private readonly dataSource: DataSource,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Bank accounts
  // ───────────────────────────────────────────────────────────────────────────

  async createBankAccount(
    dto: CreateBankAccountDto,
    organizationId: string,
  ): Promise<BankAccount> {
    const glAccount = await this.dataSource.manager.findOneBy(Account, {
      id: dto.glAccountId,
      organizationId,
    });
    if (!glAccount) {
      throw new BadRequestError('TREASURY.CUENTA_CONTABLE_NO_VALIDA');
    }
    if (!glAccount.isPostable) {
      throw new BadRequestError('TREASURY.CUENTA_CONTABLE_NO_ADMITE_MOVIMIENTOS');
    }

    return this.bankAccountRepository.save(
      this.bankAccountRepository.create({
        organizationId,
        name: dto.name,
        bankName: dto.bankName ?? null,
        accountNumber: dto.accountNumber ?? null,
        iban: dto.iban ?? null,
        swiftBic: dto.swiftBic ?? null,
        accountType: dto.accountType,
        currencyCode: dto.currencyCode.toUpperCase(),
        glAccountId: dto.glAccountId,
        openingBalance: dto.openingBalance ?? 0,
        openingDate: dto.openingDate ?? null,
        notes: dto.notes ?? null,
        isActive: true,
      }),
    );
  }

  findAllBankAccounts(organizationId: string): Promise<BankAccount[]> {
    return this.bankAccountRepository.find({
      where: { organizationId },
      relations: ['glAccount'],
      order: { name: 'ASC' },
    });
  }

  async findBankAccount(id: string, organizationId: string): Promise<BankAccount> {
    const account = await this.bankAccountRepository.findOne({
      where: { id, organizationId },
      relations: ['glAccount'],
    });
    if (!account) throw new NotFoundError('TREASURY.CUENTA_BANCARIA_NO_ENCONTRADA');
    return account;
  }

  async updateBankAccount(
    id: string,
    dto: UpdateBankAccountDto,
    organizationId: string,
  ): Promise<BankAccount> {
    const account = await this.findBankAccount(id, organizationId);

    // Field by field. Neither the currency nor the control account is assignable, whatever the
    // body contains: movements already posted were measured against both.
    if (dto.name !== undefined) account.name = dto.name;
    if (dto.bankName !== undefined) account.bankName = dto.bankName;
    if (dto.accountNumber !== undefined) account.accountNumber = dto.accountNumber;
    if (dto.iban !== undefined) account.iban = dto.iban;
    if (dto.swiftBic !== undefined) account.swiftBic = dto.swiftBic;
    if (dto.accountType !== undefined) account.accountType = dto.accountType;
    if (dto.isActive !== undefined) account.isActive = dto.isActive;
    if (dto.notes !== undefined) account.notes = dto.notes;

    return this.bankAccountRepository.save(account);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cash position
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * What is in the bank right now, by account.
   *
   * The first report of its kind in the product: there was no cash position, no cash forecast and
   * no way to answer "how much do we have" other than opening the balance sheet, which grouped
   * every current asset together and had its own problems.
   */
  async cashPosition(
    organizationId: string,
    asOf: Date | string = new Date(),
  ): Promise<CashPosition> {
    const asOfDate = toIsoDate(asOf);

    const [accounts, settings, ledger] = await Promise.all([
      this.bankAccountRepository.find({
        where: { organizationId, isActive: true },
        order: { name: 'ASC' },
      }),
      this.dataSource.manager.findOneBy(OrganizationSettings, { organizationId }),
      this.dataSource.manager.findOneBy(Ledger, { organizationId, isDefault: true }),
    ]);

    if (!ledger) {
      throw new BadRequestError(
        'TREASURY.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
      );
    }

    const balances = accounts.length
      ? await this.balances.balancesAsOf({
          organizationId,
          ledgerId: ledger.id,
          accountIds: [...new Set(accounts.map((account) => account.glAccountId))],
          asOf: asOfDate,
        })
      : new Map<string, number>();

    const rows: CashPositionRow[] = accounts.map((account) => ({
      bankAccountId: account.id,
      name: account.name,
      bankName: account.bankName,
      accountNumberMasked: maskAccountNumber(account.accountNumber),
      currencyCode: account.currencyCode,
      glAccountId: account.glAccountId,
      balanceInBaseCurrency: balances.get(account.glAccountId) ?? 0,
    }));

    // Several bank accounts may share one control account, so the total counts each control
    // account's balance once rather than once per account pointing at it.
    const countedGlAccounts = new Set<string>();
    const total = sumAmounts(
      rows
        .filter((row) => {
          if (countedGlAccounts.has(row.glAccountId)) return false;
          countedGlAccounts.add(row.glAccountId);
          return true;
        })
        .map((row) => row.balanceInBaseCurrency),
    );

    return {
      asOfDate,
      baseCurrency: settings?.baseCurrency ?? ledger.currency,
      accounts: rows,
      total,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Transfers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Move funds between two of the tenant's accounts.
   *
   * Handles the cross-currency case the old endpoint could not express at all: the caller states
   * what the destination received, the difference against what left the source is the realised
   * exchange effect, and a bank charge is booked as an expense rather than silently absorbed.
   */
  async createBankTransfer(
    dto: CreateBankTransferDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<BankTransfer> {
    return this.dataSource.transaction(async (manager) => {
      if (dto.fromBankAccountId === dto.toBankAccountId) {
        throw new BadRequestError('TREASURY.CUENTAS_ORIGEN_DESTINO_NO_PUEDEN_SER_MISMA');
      }

      const [from, to] = await Promise.all([
        this.loadBankAccount(manager, dto.fromBankAccountId, organizationId),
        this.loadBankAccount(manager, dto.toBankAccountId, organizationId),
      ]);

      const ledger = await manager.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!ledger) {
        throw new BadRequestError(
          'TREASURY.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
        );
      }

      const bankJournal = await manager.findOneBy(Journal, {
        organizationId,
        code: 'BANCOS',
      });
      if (!bankJournal) {
        throw new BadRequestError('TREASURY.DIARIO_BANCOS_BANCOS_NO_ENCONTRADO');
      }

      const sameCurrency = from.currencyCode === to.currencyCode;
      const amountReceived = sameCurrency
        ? roundAmount(dto.amount - (dto.fee ?? 0))
        : dto.amountReceived;

      if (!sameCurrency && amountReceived === undefined) {
        throw new BadRequestError('TREASURY.TRANSFERENCIA_MULTIMONEDA_REQUIERE_MONTO_RECIBIDO');
      }

      const fee = roundAmount(dto.fee ?? 0);
      const transfer = await manager.save(
        manager.create(BankTransfer, {
          organizationId,
          date: toIsoDate(dto.date) as unknown as Date,
          amount: dto.amount,
          amountReceived: amountReceived ?? dto.amount,
          fee,
          fromBankAccountId: from.id,
          toBankAccountId: to.id,
          description: dto.description,
          reference: dto.reference ?? null,
          createdByUserId: actorUserId,
        }),
      );

      const lines: CreateJournalEntryLineDto[] = [];
      const push = (
        accountId: string,
        debit: number,
        credit: number,
        description: string,
      ) => {
        if (toCents(debit) === 0 && toCents(credit) === 0) return;
        lines.push({
          accountId,
          debit,
          credit,
          description,
          valuations: [{ ledgerId: ledger.id, debit, credit }],
        });
      };

      // Both sides are converted into the books' currency at each account's own rate, so a
      // cross-currency transfer balances on its difference rather than by coincidence.
      const [sourceRate, destinationRate] = await Promise.all([
        this.exchangeRates.rateFor(from.currencyCode, ledger.currency, dto.date, manager),
        this.exchangeRates.rateFor(to.currencyCode, ledger.currency, dto.date, manager),
      ]);

      const leftSource = convert(dto.amount, sourceRate);
      const arrivedDestination = convert(amountReceived ?? dto.amount, destinationRate);
      const feeBase = convert(fee, sourceRate);

      push(to.glAccountId, arrivedDestination, 0, `Transferencia recibida — ${to.name}`);
      push(from.glAccountId, 0, leftSource, `Transferencia enviada — ${from.name}`);

      if (toCents(feeBase) !== 0) {
        const feeAccountId = await this.resolveFeeAccount(manager, organizationId);
        push(feeAccountId, feeBase, 0, 'Comisión bancaria');
      }

      const difference = roundAmount(leftSource - arrivedDestination - feeBase);
      if (toCents(difference) !== 0) {
        const forexAccountId = await this.resolveForexAccount(manager, organizationId);
        push(
          forexAccountId,
          difference > 0 ? difference : 0,
          difference < 0 ? Math.abs(difference) : 0,
          'Diferencia cambiaria en transferencia',
        );
      }

      const entry = await this.journalEntriesService.createWithManager(
        manager,
        {
          date: toIsoDate(dto.date),
          description: `Transferencia bancaria: ${dto.description}`,
          journalId: bankJournal.id,
          lines,
        } as CreateJournalEntryDto,
        organizationId,
        { actorUserId, systemReason: 'bank-transfer' },
      );

      transfer.journalEntryId = entry.id;
      const saved = await manager.save(transfer);

      this.logger.log(
        `Transferencia ${saved.id.slice(0, 8)} contabilizada en ${entry.entryNumber}.`,
      );
      return saved;
    });
  }

  findAllTransfers(organizationId: string): Promise<BankTransfer[]> {
    return this.dataSource.getRepository(BankTransfer).find({
      where: { organizationId },
      order: { date: 'DESC', createdAt: 'DESC' },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async loadBankAccount(
    manager: EntityManager,
    id: string,
    organizationId: string,
  ): Promise<BankAccount> {
    const account = await manager.findOneBy(BankAccount, { id, organizationId });
    if (!account) throw new NotFoundError('TREASURY.CUENTA_BANCARIA_NO_ENCONTRADA');
    if (!account.isActive) {
      throw new BadRequestError('TREASURY.CUENTA_BANCARIA_INACTIVA', { name: account.name });
    }
    return account;
  }

  /**
   * Where a bank charge is booked.
   *
   * A fee is a cost of banking, not an exchange difference, so it does not share the forex account:
   * netting them would hide the charge inside a line an accountant reads as currency movement.
   */
  private async resolveFeeAccount(
    manager: EntityManager,
    organizationId: string,
  ): Promise<string> {
    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    const feeAccountId =
      settings?.defaultBankFeesAccountId ?? settings?.defaultForexGainLossAccountId;
    if (!feeAccountId) {
      throw new BadRequestError('TREASURY.CUENTA_COMISIONES_NO_CONFIGURADA');
    }
    return feeAccountId;
  }

  private async resolveForexAccount(
    manager: EntityManager,
    organizationId: string,
  ): Promise<string> {
    const account = await manager.findOne(Account, {
      where: { organizationId, systemRole: AccountRole.FOREX_GAIN_LOSS },
    });
    if (account) return account.id;

    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    if (!settings?.defaultForexGainLossAccountId) {
      throw new BadRequestError('TREASURY.CUENTA_DIFERENCIA_CAMBIARIA_NO_CONFIGURADA');
    }
    return settings.defaultForexGainLossAccountId;
  }
}
