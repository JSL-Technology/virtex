import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import { parse as parseDate, isValid } from 'date-fns';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import {
  PreviewImportResponseDto,
  ConfirmImportDto,
  PreviewImportRequestDto,
  PreviewedJournalEntryDto,
  ImportRowErrorDto,
} from './dto/journal-entry-import.dto';
import { FileParserService } from './parsers/file-parser.service';
import { EventsGateway } from '../websockets/events.gateway';
import { Journal } from './entities/journal.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import {
  ImportBatchStatus,
  JournalEntryImportBatch,
} from './entities/journal-entry-import-batch.entity';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { LocalizedResult } from '../i18n/localized-message';
import { parseDecimal } from '../common/parse-decimal';
import { toCents } from '../common/money';

/**
 * How long a previewed batch stays confirmable.
 *
 * Long enough for someone to read a hundred-entry preview; short enough that a batch nobody
 * confirmed is not still sitting there tomorrow.
 */
const BATCH_LIFETIME_MS = 30 * 60 * 1000;

/**
 * The most rows one import may carry.
 *
 * There was no limit. The preview parsed the whole file, built a `CreateJournalEntryDto` per
 * entry, kept a copy of every source row in the response *and* another in the cache, and the
 * confirm posted all of them inside one transaction. A 2 MB file — the upload limit — of narrow
 * rows is well over a hundred thousand lines.
 */
const MAX_ROWS = 20_000;

/**
 * Importing a journal from a file.
 *
 * ## What this used to do to the figures
 *
 * `parseFloat(row[column] || '0')` for the amounts. That reads one convention — a period for the
 * decimal point, no grouping — and fails silently on the other by returning a plausible number:
 * `1.234,56`, the ordinary way of writing money in most of Latin America, became **1.234**. The
 * entry still balanced, because both of its sides were divided by the same thousand, so nothing
 * downstream could notice. `parseFloat('12abc')` became 12.
 *
 * `new Date(row[dateColumn]).toISOString()` for the date. `new Date('03/04/2026')` is 4 March in
 * the United States and 3 April almost everywhere else, and the file says which it meant nowhere;
 * an unreadable date threw `RangeError` out of `toISOString`, which reached the caller as a 500.
 *
 * `Math.abs(totalDebit - totalCredit) < 0.01` for the balance check, over floats accumulated with
 * `+=`. An entry genuinely out by up to a cent was imported as balanced, into a double-entry
 * ledger whose whole guarantee is that it is not.
 *
 * And no check that the account it mapped to could take a movement at all, so an import could post
 * to a grouping account — which no other path in the product allows.
 */
@Injectable()
export class JournalEntryImportService {
  private readonly logger = new Logger(JournalEntryImportService.name);

  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(JournalEntryImportBatch)
    private readonly batchRepository: Repository<JournalEntryImportBatch>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
    private readonly fileParser: FileParserService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async getFileHeaders(file: FastifyFile): Promise<string[]> {
    const { headers } = await this.fileParser.parse(file);
    return headers;
  }

  async preview(
    file: FastifyFile,
    mapping: PreviewImportRequestDto,
    organizationId: string,
    userId: string,
  ): Promise<PreviewImportResponseDto> {
    const { data } = await this.fileParser.parse(file);
    if (data.length === 0) throw new BadRequestError('JOURNAL_ENTRIES.ARCHIVO_NO_CONTIENE_DATOS');
    if (data.length > MAX_ROWS) {
      throw new BadRequestError('JOURNAL_ENTRIES.IMPORT.DEMASIADAS_FILAS', {
        rows: data.length,
        max: MAX_ROWS,
      });
    }

    const accounts = await this.accountRepository.find({
      where: { organizationId },
      select: ['id', 'code', 'isPostable', 'isActive'],
    });
    const accountsByCode = new Map(accounts.map((account) => [account.code, account]));

    const generalJournal = await this.dataSource
      .getRepository(Journal)
      .findOneBy({ organizationId, code: 'GENERAL' });
    if (!generalJournal) {
      throw new BadRequestError(
        'JOURNAL_ENTRIES.DIARIO_GENERAL_GENERAL_NO_ENCONTRADO_NECESARIO_IMPORTACION',
      );
    }

    const defaultLedger = await this.dataSource
      .getRepository(Ledger)
      .findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
      throw new BadRequestError(
        'JOURNAL_ENTRIES.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION',
      );
    }

    const previews: PreviewedJournalEntryDto[] = [];
    const postable: CreateJournalEntryDto[] = [];

    for (const [entryId, rows] of this.groupRows(data, mapping.columnMapping.entryId)) {
      const preview = this.previewEntry(entryId, rows, mapping, accountsByCode);
      previews.push(preview.dto);
      if (preview.entry) {
        postable.push({
          ...preview.entry,
          journalId: generalJournal.id,
          lines: preview.entry.lines.map((line) => ({
            ...line,
            valuations: [{ ledgerId: defaultLedger.id, debit: line.debit, credit: line.credit }],
          })),
        });
      }
    }

    const batch = await this.batchRepository.save(
      this.batchRepository.create({
        organizationId,
        createdByUserId: userId,
        status: ImportBatchStatus.PENDING,
        entries: postable,
        expiresAt: new Date(Date.now() + BATCH_LIFETIME_MS),
      }),
    );

    await this.sweepExpiredBatches();

    return {
      batchId: batch.id,
      totalEntries: previews.length,
      validEntriesCount: postable.length,
      invalidEntriesCount: previews.length - postable.length,
      previews,
    };
  }

  /**
   * One entry from its rows: everything readable, or the reasons it is not.
   *
   * Returns the postable entry only when *every* row of it is sound, because a journal entry is
   * atomic — half an entry is not a smaller entry, it is an unbalanced one.
   */
  private previewEntry(
    entryId: string,
    rows: Record<string, string>[],
    mapping: PreviewImportRequestDto,
    accountsByCode: Map<string, Pick<Account, 'id' | 'code' | 'isPostable' | 'isActive'>>,
  ): { dto: PreviewedJournalEntryDto; entry: CreateJournalEntryDto | null } {
    const columns = mapping.columnMapping;
    const entryErrors: ImportRowErrorDto[] = [];

    // Integer cents throughout. `totalDebit += parseFloat(...)` accumulated binary floating-point
    // error and was then compared with a 0.01 tolerance, so an entry genuinely out by up to a cent
    // was imported as balanced.
    let debitCents = 0;
    let creditCents = 0;
    let allRowsValid = true;

    const lines: CreateJournalEntryDto['lines'] = [];
    const validatedRows = rows.map((row, index) => {
      const error = this.validateRow(row, columns, mapping.decimalSeparator, accountsByCode);
      if (error) {
        allRowsValid = false;
        return { lineNumber: index + 1, isValid: false, error, data: row };
      }

      const debit = parseDecimal(row[columns.debit], mapping.decimalSeparator) ?? 0;
      const credit = parseDecimal(row[columns.credit], mapping.decimalSeparator) ?? 0;
      debitCents += toCents(debit);
      creditCents += toCents(credit);

      lines.push({
        accountId: accountsByCode.get(String(row[columns.accountCode]).trim())!.id,
        debit,
        credit,
        description: columns.lineDescription ? (row[columns.lineDescription] ?? '') : '',
      });
      return { lineNumber: index + 1, isValid: true, data: row };
    });

    if (debitCents !== creditCents) {
      entryErrors.push({
        messageKey: 'JOURNAL_ENTRIES.IMPORT.ASIENTO_NO_CUADRA',
        params: { debit: debitCents / 100, credit: creditCents / 100 },
      });
    }

    // The date and description come from the first row, so they are validated once, here, rather
    // than per row. An unreadable date used to become `Invalid Date` and then throw out of
    // `toISOString()` — a 500 for a typo in a spreadsheet.
    const first = rows[0] ?? {};
    const rawDate = String(first[columns.date] ?? '').trim();
    const parsed = parseDate(rawDate, mapping.dateFormat, new Date());
    if (!rawDate || !isValid(parsed)) {
      entryErrors.push({
        messageKey: 'JOURNAL_ENTRIES.IMPORT.FECHA_NO_LEGIBLE',
        params: { value: rawDate, format: mapping.dateFormat },
      });
    }

    const description = String(first[columns.description] ?? '').trim();
    if (!description) {
      entryErrors.push({ messageKey: 'JOURNAL_ENTRIES.IMPORT.SIN_DESCRIPCION' });
    }

    const isBalanced = debitCents === creditCents;
    const dto: PreviewedJournalEntryDto = {
      entryId,
      isBalanced,
      totalDebit: debitCents / 100,
      totalCredit: creditCents / 100,
      errors: entryErrors,
      rows: validatedRows,
    };

    if (!allRowsValid || entryErrors.length > 0) return { dto, entry: null };

    return {
      dto,
      entry: {
        // `date-fns` builds a local `Date` and these getters read it back locally, so the two
        // halves agree in every zone. Routing this through `common/dates`, whose `toIsoDate` is
        // UTC, would move every imported entry by a day east of Greenwich.
        date: this.toIsoDate(parsed),
        description,
        journalId: '',
        lines,
      },
    };
  }

  /** Everything that can be wrong with one row, in the order a reader would want to hear it. */
  private validateRow(
    row: Record<string, string>,
    columns: PreviewImportRequestDto['columnMapping'],
    decimalSeparator: '.' | ',',
    accountsByCode: Map<string, Pick<Account, 'id' | 'code' | 'isPostable' | 'isActive'>>,
  ): ImportRowErrorDto | null {
    for (const column of [columns.debit, columns.credit]) {
      const raw = row[column];
      if (parseDecimal(raw, decimalSeparator) === null) {
        return {
          messageKey: 'JOURNAL_ENTRIES.IMPORT.IMPORTE_NO_LEGIBLE',
          params: { value: String(raw ?? ''), separator: decimalSeparator },
        };
      }
    }

    const debit = parseDecimal(row[columns.debit], decimalSeparator) ?? 0;
    const credit = parseDecimal(row[columns.credit], decimalSeparator) ?? 0;

    // A negative debit is a credit written in the wrong column; accepting it would let one line
    // silently reverse the sense of the entry.
    if (debit < 0 || credit < 0) {
      return { messageKey: 'JOURNAL_ENTRIES.IMPORT.IMPORTE_NEGATIVO' };
    }
    if (toCents(debit) !== 0 && toCents(credit) !== 0) {
      return { messageKey: 'JOURNAL_ENTRIES.IMPORT.LINEA_CON_AMBOS_LADOS' };
    }
    if (toCents(debit) === 0 && toCents(credit) === 0) {
      return { messageKey: 'JOURNAL_ENTRIES.IMPORT.LINEA_SIN_MOVIMIENTO' };
    }

    const code = String(row[columns.accountCode] ?? '').trim();
    const account = accountsByCode.get(code);
    if (!account) {
      return { messageKey: 'JOURNAL_ENTRIES.IMPORT.CUENTA_NO_EXISTE', params: { code } };
    }
    // Nothing checked either of these. An import could post to a grouping account, which no other
    // path in the product allows, and to an account someone had deactivated.
    if (!account.isPostable) {
      return {
        messageKey: 'JOURNAL_ENTRIES.IMPORT.CUENTA_NO_ADMITE_MOVIMIENTOS',
        params: { code },
      };
    }
    if (!account.isActive) {
      return { messageKey: 'JOURNAL_ENTRIES.IMPORT.CUENTA_INACTIVA', params: { code } };
    }

    return null;
  }

  async confirm(
    confirmDto: ConfirmImportDto,
    organizationId: string,
    userId: string,
  ): Promise<LocalizedResult<{ createdEntriesCount: number }>> {
    const batch = await this.batchRepository.findOneBy({
      id: confirmDto.batchId,
      organizationId,
    });
    if (!batch || batch.status !== ImportBatchStatus.PENDING || batch.expiresAt <= new Date()) {
      throw new NotFoundError('JOURNAL_ENTRIES.LOTE_IMPORTACION_NO_ENCONTRADO_EXPIRADO_YA_PROCESADO');
    }
    // A batch is a draft of one person's work, not a shared resource.
    if (batch.createdByUserId !== userId) {
      throw new BadRequestError('JOURNAL_ENTRIES.IMPORT.LOTE_DE_OTRO_USUARIO');
    }

    const totalEntries = batch.entries.length;
    let processedCount = 0;

    try {
      await this.dataSource.transaction(async (manager) => {
        // Marked spent inside the same transaction that posts the entries: two confirms racing on
        // the same batch cannot both succeed, and a rollback leaves it PENDING and retryable.
        const claimed = await manager
          .createQueryBuilder()
          .update(JournalEntryImportBatch)
          .set({ status: ImportBatchStatus.CONFIRMED })
          .where('id = :id AND status = :pending', {
            id: batch.id,
            pending: ImportBatchStatus.PENDING,
          })
          .execute();
        if (claimed.affected === 0) {
          throw new NotFoundError(
            'JOURNAL_ENTRIES.LOTE_IMPORTACION_NO_ENCONTRADO_EXPIRADO_YA_PROCESADO',
          );
        }

        for (const entryDto of batch.entries) {
          await this.journalEntriesService.createWithManager(manager, entryDto, organizationId, {
            actorUserId: userId,
          });
          processedCount += 1;
        }
      });
    } catch (error) {
      await this.batchRepository.update(
        { id: batch.id, status: ImportBatchStatus.PENDING },
        { status: ImportBatchStatus.FAILED },
      );
      this.eventsGateway.sendToUser(userId, 'import-complete', {
        batchId: batch.id,
        status: 'FAILED',
      });
      throw error;
    }

    // After the commit, not inside it: a client told an entry was posted and then seeing the
    // transaction roll back has been lied to.
    this.eventsGateway.sendToUser(userId, 'import-progress', {
      batchId: batch.id,
      progress: 100,
      processed: processedCount,
      total: totalEntries,
    });
    this.eventsGateway.sendToUser(userId, 'import-complete', {
      batchId: batch.id,
      status: 'SUCCESS',
      messageKey: 'JOURNAL_ENTRIES.IMPORTACION_CONFIRMADA_PROCESADA_EXITOSAMENTE',
      createdEntriesCount: totalEntries,
    });

    this.logger.log(`Lote de importación ${batch.id} confirmado: ${totalEntries} asientos.`);

    return {
      messageKey: 'JOURNAL_ENTRIES.IMPORTACION_CONFIRMADA_PROCESADA_EXITOSAMENTE',
      createdEntriesCount: totalEntries,
    };
  }

  /**
   * Rows grouped by the entry they belong to, in the order the file lists them.
   *
   * A `Map`, not an object literal: a file whose entry ids are `1`, `2`, `10` came back from
   * `Object.keys` in numeric order rather than file order, and an entry id of `__proto__` — which
   * a file may perfectly well contain — reached an object used as a dictionary.
   */
  private groupRows(
    rows: Record<string, string>[],
    entryIdColumn: string,
  ): Map<string, Record<string, string>[]> {
    const grouped = new Map<string, Record<string, string>[]>();
    for (const row of rows) {
      const entryId = String(row[entryIdColumn] ?? '').trim();
      const existing = grouped.get(entryId);
      if (existing) existing.push(row);
      else grouped.set(entryId, [row]);
    }
    return grouped;
  }

  /**
   * A parsed date as `YYYY-MM-DD`, read with the same local getters `date-fns` wrote it with.
   *
   * Deliberately not `common/dates`, whose `toIsoDate` is UTC: `date-fns` builds a *local* `Date`,
   * so reading it in UTC would move every imported entry by a day for any deployment east of
   * Greenwich. `csv-parser.spec.ts` pins the same invariant for bank statements.
   */
  private toIsoDate(date: Date): string {
    const year = date.getFullYear().toString().padStart(4, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** Batches nobody confirmed. Cheap, indexed, and no longer the only thing keeping memory down. */
  private async sweepExpiredBatches(): Promise<void> {
    await this.batchRepository.delete({ expiresAt: LessThan(new Date()) });
  }
}
