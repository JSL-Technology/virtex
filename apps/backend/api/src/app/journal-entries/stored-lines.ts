import { EntityManager, In } from 'typeorm';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { Journal } from './entities/journal.entity';
import { BadRequestError } from '../i18n/localized.exception';
import { normaliseDimensionTags } from '../dimensions/dimension-tags';
import { toCents } from '../common/money';

/** A line kept to be posted later: by a recurring entry, or from a template. */
export interface StoredLine {
  accountId: string;
  description?: string;
  debit?: number;
  credit?: number;
  dimensions?: Record<string, string> | null;
}

/**
 * The accounts a stored line names exist in this company, are active and take postings, and its
 * dimension tags name active dimensions and values. Returns the lines with their tags normalised.
 *
 * Recurring entries and templates were saved unchecked. A typo'd account, a header account or an
 * entry that did not balance was accepted, and failed later — at 1 a.m., in a queue, every day,
 * with nobody looking — so the rent was simply not booked. Refusing it when it is saved is when
 * the person who can fix it is there.
 */
export async function assertStoredLines<T extends StoredLine>(
  manager: EntityManager,
  organizationId: string,
  lines: readonly T[],
): Promise<T[]> {
  const ids = [...new Set(lines.map((line) => line.accountId))];
  const accounts = ids.length
    ? await manager.find(Account, { where: { id: In(ids), organizationId } })
    : [];
  const byId = new Map(accounts.map((account) => [account.id, account]));
  lines.forEach((line, index) => {
    const account = byId.get(line.accountId);
    if (!account) throw new BadRequestError('journal_entries.stored_line_account_not_found', { line: index + 1 });
    if (!account.isActive || !account.isPostable || account.isBlockedForPosting) {
      throw new BadRequestError('journal_entries.stored_line_account_not_postable', {
        line: index + 1,
        code: account.code,
      });
    }
  });
  const tags = await normaliseDimensionTags(manager, organizationId, lines);
  return lines.map((line, index) => ({ ...line, dimensions: tags[index] ?? null }));
}

/** Amounts on each line, one side each, and debits equal to credits — to the cent. */
export function assertBalancedLines(lines: readonly StoredLine[]): void {
  if (lines.length < 2) throw new BadRequestError('journal_entries.stored_lines_at_least_two');
  let debits = 0;
  let credits = 0;
  lines.forEach((line, index) => {
    const debit = toCents(Number(line.debit ?? 0));
    const credit = toCents(Number(line.credit ?? 0));
    if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) {
      throw new BadRequestError('journal_entries.stored_line_one_side', { line: index + 1 });
    }
    debits += debit;
    credits += credit;
  });
  if (debits !== credits) throw new BadRequestError('journal_entries.journal_entry_does_not_balance');
}

/** The journal exists in this company. */
export async function assertJournal(manager: EntityManager, organizationId: string, journalId: string): Promise<void> {
  const journal = await manager.findOne(Journal, { where: { id: journalId, organizationId } });
  if (!journal) throw new BadRequestError('journal_entries.specified_journal_does_not_exist_organization');
}
