import { JournalEntriesService } from './journal-entries.service';

/**
 * A person reverses what a person wrote (QA R3-B08). An entry a document posted is reversed by
 * voiding that document; reversed directly, the ledger and the document disagree.
 */
describe('JournalEntriesService.reverse — entries posted by a document', () => {
  function build(
    found: { id: string; systemReason: string | null; entryNumber: string | null } | null,
    capitalized: Array<{ number: string }> = [],
  ) {
    const service = Object.create(JournalEntriesService.prototype) as JournalEntriesService;
    const internals = service as unknown as Record<string, unknown>;
    // `query` answers which fixed assets were capitalized from the entry (FINB-15).
    const manager = { findOne: jest.fn(async () => found), query: jest.fn(async () => capitalized) };
    internals['dataSource'] = { transaction: (work: (m: unknown) => unknown) => work(manager) };
    const reverseWithin = jest.fn<Promise<{ id: string }>, unknown[]>(async () => ({ id: 'reversal' }));
    internals['reverseWithin'] = reverseWithin;
    return { service, reverseWithin };
  }

  it('refuses an entry an invoice posted, and says to void the invoice', async () => {
    const { service, reverseWithin } = build({ id: 'je-1', systemReason: 'invoice-issued', entryNumber: 'VENTAS-2026-000001' });
    await expect(
      service.reverse('je-1', 'org-1', { reversalDate: '2026-11-01', reason: 'error' }, { actorUserId: 'u-1' }),
    ).rejects.toMatchObject({
      messageKey: 'journal_entries.document_entry_reverse_through_document',
      params: { number: 'VENTAS-2026-000001' },
    });
    expect(reverseWithin).not.toHaveBeenCalled();
  });

  it('refuses an entry fixed assets were capitalized from: their cost would leave the ledger while the register kept them', async () => {
    const { service, reverseWithin } = build({ id: 'je-3', systemReason: null, entryNumber: 'GENERAL-2026-000010' }, [{ number: 'AF-2026-000004' }]);
    await expect(
      service.reverse('je-3', 'org-1', { reversalDate: '2026-11-01', reason: 'error' }, { actorUserId: 'u-1' }),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.entry_capitalized_fixed_assets', params: { assets: 'AF-2026-000004' } });
    expect(reverseWithin).not.toHaveBeenCalled();
  });

  it('reverses an entry a person wrote', async () => {
    const { service, reverseWithin } = build({ id: 'je-2', systemReason: null, entryNumber: 'GENERAL-2026-000009' });
    await expect(
      service.reverse('je-2', 'org-1', { reversalDate: '2026-11-01', reason: 'Clasificación errónea' }, { actorUserId: 'u-1' }),
    ).resolves.toEqual({ id: 'reversal' });
    expect(reverseWithin).toHaveBeenCalledTimes(1);
  });
});
