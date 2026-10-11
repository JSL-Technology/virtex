import { describeEntryOrigin } from './entry-origin';

describe('describeEntryOrigin', () => {
  it('locks the accounting of an invoice and links to it', () => {
    const origin = describeEntryOrigin({ systemReason: 'invoice-issued', idempotencyKey: 'invoice:abc:revenue' });
    expect(origin.locked).toBe(true);
    expect(origin.document).toEqual({ type: 'invoice', id: 'abc', route: '/invoices/abc' });
  });

  it('keeps a manual entry editable', () => {
    expect(describeEntryOrigin({ systemReason: null, idempotencyKey: null }).locked).toBe(false);
  });

  it('keeps editable what a person wrote and the system only posted', () => {
    for (const reason of ['approval-granted', 'recurring-entry', 'audit-adjustment']) {
      expect(describeEntryOrigin({ systemReason: reason }).locked).toBe(false);
    }
  });

  it('names no document for a key it does not know', () => {
    expect(describeEntryOrigin({ systemReason: 'fx-revaluation', idempotencyKey: 'whatever' }).document).toBeNull();
  });
});
