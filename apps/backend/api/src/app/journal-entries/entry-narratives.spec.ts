import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SUPPORTED_LANGUAGES, composeKey, isNarrativeRef } from '@virtex/shared/types';
import { I18nService } from '../i18n/i18n.service';
import { LedgerNarrativeService } from './ledger-narrative.service';
import { AdjustmentsService } from './adjustments.service';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { AdjustmentType } from './dto/period-end-adjustment.dto';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { LedgerText, withNote } from '../contracts/ledger-posting/ledger-text';

/**
 * The narratives the system writes on entries (books bilingual, part 2), without a database: what
 * the API lets in, what the narrative service keeps, and the two narratives that printed an
 * account's name as «[object Object]». What PostgreSQL stores and refuses is
 * `entry-narratives.integration.spec.ts`.
 */
describe('system narratives', () => {
  const i18n = new I18nService();
  const narrative = new LedgerNarrativeService(i18n);
  const ORG = '11111111-1111-4111-8111-111111111111';
  const JOURNAL = '22222222-2222-4222-8222-222222222222';
  const CASH = '33333333-3333-4333-8333-333333333333';
  const BANK = '44444444-4444-4444-8444-444444444444';

  /**
   * A manager that knows two accounts and one company, keeping its books in `language`: the only
   * other row anything here reads is the company's, for its books language.
   */
  const managerFor = (language: string) => ({
    findOne: jest.fn(async (entity: unknown, options: { where: { id: string } }) => {
      if (entity !== Account) return { id: options.where.id, booksLanguage: language };
      return (
        (
          {
            [CASH]: { id: CASH, code: '1101', name: { es: 'Caja general', en: 'Petty cash' } },
            [BANK]: { id: BANK, code: '1102', name: { es: 'Bancos', en: 'Banks', pt: 'Bancos' } },
          } as Record<string, unknown>
        )[options.where.id] ?? null
      );
    }),
  });

  describe('what the API lets in', () => {
    // The global pipe, as `main.ts` configures it.
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
    const body = (extra: Record<string, unknown>, lineExtra: Record<string, unknown> = {}) => ({
      date: '2026-06-10',
      description: 'Pago de luz',
      journalId: JOURNAL,
      lines: [
        { accountId: CASH, debit: 10, credit: 0, ...lineExtra },
        { accountId: BANK, debit: 0, credit: 10 },
      ],
      ...extra,
    });
    const validate = (value: unknown) => pipe.transform(value, { type: 'body', metatype: CreateJournalEntryDto });
    const forged = { key: 'ledger.sales.invoice', params: { number: 'B0100000001', customer: 'QA' } };

    it('accepts an entry a person writes — the narrative is a type, never a property it carries', async () => {
      await expect(validate(body({}))).resolves.toBeInstanceOf(CreateJournalEntryDto);
    });

    it('refuses a narrative on the entry: only the system says what a narrative was written from', async () => {
      await expect(validate(body({ narrative: forged }))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a narrative on a line, for the same reason', async () => {
      await expect(validate(body({}, { narrative: forged }))).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('what the narrative service keeps', () => {
    it('writes in the books language and keeps the message and its values', async () => {
      const text = await narrative.describe(managerFor('es') as never, ORG, 'ledger.reconciliation.category_line', {
        account: { es: 'Gastos bancarios', en: 'Bank charges' },
      });
      expect(text.text).toBe('Categoría: Gastos bancarios');
      expect(text.ref).toEqual({ key: 'ledger.reconciliation.category_line', params: { account: { es: 'Gastos bancarios', en: 'Bank charges' } } });
      expect(isNarrativeRef(text.ref)).toBe(true);
    });

    it('writes in the books language of the company, whatever the reader’s', async () => {
      const text = await narrative.describe(managerFor('en') as never, '55555555-5555-4555-8555-555555555555', 'ledger.reconciliation.category_line', {
        account: { es: 'Gastos bancarios', en: 'Bank charges' },
      });
      expect(text.text).toBe('Category: Bank charges');
    });

    it('nests a narrative inside another: its text in the books, its message in the values', async () => {
      const manager = managerFor('es');
      const year = await narrative.describe(manager as never, ORG, 'ledger.result_transfer.fiscal_year', { from: '2026-01-01', to: '2026-12-31' });
      const closing = await narrative.describe(manager as never, ORG, 'ledger.result_transfer.entry', { period: year });
      expect(closing.text).toContain(year.text);
      expect(closing.ref.params['period']).toEqual(year.ref);
    });

    it('drops a value that is not there rather than storing it as nothing', async () => {
      const text = await narrative.describe(managerFor('es') as never, ORG, 'ledger.with_note', { narrative: 'Ajuste', note: undefined });
      expect(Object.keys(text.ref.params)).toEqual(['narrative']);
    });

    it('keeps a typed note as typed and the narrative as its message', () => {
      const base = new LedgerText('Ajuste de inventario', { key: 'ledger.inventory.adjustment_entry', params: { product: 'QA-1' } });
      const noted = withNote(base, '  conteo físico ');
      expect(noted.text).toBe('Ajuste de inventario — conteo físico');
      expect(noted.ref).toEqual({ key: 'ledger.with_note', params: { narrative: base.ref, note: 'conteo físico' } });
      expect(withNote(base, '   ')).toBe(base);
    });
  });

  describe('the narratives that printed «[object Object]»', () => {
    const posted = () => {
      const create = jest.fn(async (dto: unknown) => dto);
      const createWithQueryRunner = jest.fn(async (_runner: unknown, dto: unknown) => dto);
      return { create, createWithQueryRunner };
    };

    it('names both accounts of a reclassification by code and name, in the books language, with the name kept whole', async () => {
      const entries = posted();
      const manager = managerFor('es');
      const service = new AdjustmentsService(entries as never, { manager } as never, narrative);
      await service.createReclassification(
        { ledgerId: 'l', date: '2026-06-10', description: 'Reclasificación QA', fromAccountId: CASH, toAccountId: BANK, amount: 25, journalId: JOURNAL },
        ORG,
        'actor',
      );
      const dto = entries.create.mock.calls[0][0] as { lines: { description: string; narrative: { key: string; params: Record<string, unknown> } }[] };
      const [out, into] = dto.lines;
      expect(out.description).toBe('Transferencia a la cuenta relacionada 1102 — Bancos');
      expect(into.description).toBe('Transferencia desde la cuenta relacionada 1101 — Caja general');
      expect(JSON.stringify(dto)).not.toContain('[object Object]');
      // The label is a narrative of its own: an English reader reads «1102 — Banks».
      expect(out.narrative.params['account']).toEqual({
        key: 'ledger.account_label',
        params: { code: '1102', name: { es: 'Bancos', en: 'Banks', pt: 'Bancos' } },
      });
    });

    it('refuses an account the company does not have, rather than naming a UUID in the books', async () => {
      const service = new AdjustmentsService(posted() as never, { manager: managerFor('es') } as never, narrative);
      await expect(
        service.createReclassification(
          { ledgerId: 'l', date: '2026-06-10', description: 'x', fromAccountId: CASH, toAccountId: '66666666-6666-4666-8666-666666666666', amount: 1, journalId: JOURNAL },
          ORG,
          'actor',
        ),
      ).rejects.toMatchObject({ messageKey: 'journal_entries.one_more_accounts_not_found_inactive' });
    });

    it('says the adjustment type in words of the books language — never the enum value', async () => {
      const entries = posted();
      const manager = { ...managerFor('es'), queryRunner: {}, save: jest.fn() };
      const service = new AdjustmentsService(entries as never, { transaction: (work: (m: unknown) => unknown) => work(manager) } as never, narrative);
      await service.createPeriodEndAdjustment(
        { ledgerId: 'l', date: '2026-06-30', description: 'Intereses', adjustmentType: AdjustmentType.ACCRUAL, lines: [], journalId: JOURNAL },
        ORG,
      );
      const dto = entries.createWithQueryRunner.mock.calls[0][1] as { description: string; narrative: { params: Record<string, unknown> } };
      expect(dto.description).toBe('Ajuste de fin de período (devengo): Intereses');
      expect(dto.narrative.params['type']).toBe('ledger.adjustment_type.accrual');
    });

    it('has words for every adjustment type, in every language', () => {
      for (const type of Object.values(AdjustmentType)) {
        const key = composeKey('ledger.adjustment_type', type);
        for (const language of SUPPORTED_LANGUAGES) {
          expect(i18n.translate(key, language)).not.toBe(key);
        }
      }
    });
  });
});
