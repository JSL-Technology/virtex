import { AccountsPayableService } from './accounts-payable.service';

/**
 * The number on a supplier's document, checked by the rule of the company's own market.
 *
 * QA B-02: a purchase backed by a document the authority issues in the supplier's name needs that
 * supplier identified, because the return reports each purchase against their identifier and
 * rejects a line without one. The check used to run for one market and to skip every other, so the
 * same supplier invoice could be recorded — and paid — twice anywhere else (AP-03), and the refusal
 * named the Dominican comprobante to a tenant of any country.
 */
describe('the supplier’s document, by its market’s rule', () => {
  const service = Object.create(AccountsPayableService.prototype) as AccountsPayableService;

  type Manager = { query: jest.Mock<Promise<unknown[]>, [string, unknown[]?]> };
  const managerFor = (country: string | null, existing: Array<{ id: string }>): Manager => ({
    query: jest.fn(async (sql: string) =>
      sql.includes('organizations') ? [{ country }] : sql.includes('vendor_bills') ? existing : [],
    ),
  });

  const assertIdentity = (manager: Manager, raw: string | null, supplier: unknown): Promise<string | null> =>
    (
      service as unknown as {
        assertFiscalIdentity: (m: unknown, org: string, raw: string | null, s: unknown) => Promise<string | null>;
      }
    ).assertFiscalIdentity(manager, 'org-1', raw, supplier);

  const check = (
    country: string | null,
    raw: string | null,
    supplier: { id?: string; name: string; taxId?: string | null },
    existing: Array<{ id: string }> = [],
  ): Promise<string | null> => assertIdentity(managerFor(country, existing), raw, supplier);

  it('refuses a document the authority issues in the supplier’s name when the supplier is unidentified', async () => {
    await expect(check('DO', 'B0100000001', { name: 'Sin RNC SRL', taxId: null })).rejects.toMatchObject({
      messageKey: 'accounts_payable.supplier_document_requires_supplier_tax_id',
      params: { supplier: 'Sin RNC SRL', document: 'B0100000001', authority: 'DGII' },
    });
  });

  it('accepts a valid identifier and returns the number in the market’s canonical form', async () => {
    await expect(check('DO', 'b01-0000-0001', { name: 'X', taxId: '130-86234-6' })).resolves.toBe('B0100000001');
  });

  it('says what the authority refused and why, in that authority’s name', async () => {
    await expect(check('DO', 'B01-123', { name: 'X', taxId: '130862346' })).rejects.toMatchObject({
      messageKey: 'accounts_payable.supplier_document_refused',
      params: { document: 'B01-123', authority: 'DGII', reason: 'format' },
    });
    await expect(check('DO', 'B9900000001', { name: 'X', taxId: '130862346' })).rejects.toMatchObject({
      messageKey: 'accounts_payable.supplier_document_refused',
      params: { reason: 'unknown_type' },
    });
  });

  it('needs no supplier identifier where the company issues the document itself', async () => {
    // A minor expense and a payment abroad: the counterparty has no local identifier by definition.
    await expect(check('DO', 'B1300000001', { name: 'Colmado', taxId: null })).resolves.toBe('B1300000001');
    await expect(check('DO', 'B1700000001', { name: 'AWS', taxId: null })).resolves.toBe('B1700000001');
  });

  it('checks the number of any market that publishes a shape, not one market’s', async () => {
    // The CFDI folio fiscal is a UUID the SAT stamped: a Mexican purchase is checked by the SAT's
    // rule and refused in the SAT's name, which the previous version never did for any market but one.
    await expect(check('MX', 'A-123', { name: 'Proveedor MX' })).rejects.toMatchObject({
      messageKey: 'accounts_payable.supplier_document_refused',
      params: { document: 'A-123', authority: 'SAT', reason: 'format' },
    });
    await expect(check('MX', '6f8b1c2a-1234-4abc-9def-0123456789ab', { name: 'Proveedor MX' })).resolves.toBe(
      '6F8B1C2A-1234-4ABC-9DEF-0123456789AB',
    );
  });

  it('keeps as printed a number no authority publishes a shape for, and refuses nothing', async () => {
    // The honest answer in a market whose rule verifies nothing — the supplier's own invoice number:
    // not an error, and not a claim. The caller keeps what was typed; `null` says «nothing to correct».
    await expect(check('US', 'INV-7781', { name: 'Supplier LLC', taxId: null })).resolves.toBeNull();
    await expect(check(null, 'cualquier-cosa', { name: 'Sin mercado', taxId: null })).resolves.toBeNull();
  });

  it('does not apply when no number was given', async () => {
    await expect(check('DO', null, { name: 'Informal', taxId: null })).resolves.toBeNull();
    await expect(check('DO', '   ', { name: 'Informal', taxId: null })).resolves.toBeNull();
  });

  it('refuses the same document from the same supplier on a second live bill, in any market', async () => {
    const duplicate = { messageKey: 'accounts_payable.supplier_document_already_recorded' };
    await expect(
      check('DO', 'B0100000001', { id: 'sup-1', name: 'X', taxId: '130862346' }, [{ id: 'bill-1' }]),
    ).rejects.toMatchObject(duplicate);
    // The rule ran in one market only: elsewhere the same invoice could be entered and paid twice.
    await expect(
      check('MX', '6f8b1c2a-1234-4abc-9def-0123456789ab', { id: 'sup-2', name: 'Proveedor MX' }, [{ id: 'bill-2' }]),
    ).rejects.toMatchObject(duplicate);
    await expect(
      check('US', 'INV-7781', { id: 'sup-3', name: 'Supplier LLC' }, [{ id: 'bill-3' }]),
    ).rejects.toMatchObject(duplicate);
  });

  it('compares the key as the database stores it, so case alone is not a different document', async () => {
    // A market that keeps the number as printed hands back mixed case and punctuation; the stored key
    // is upper-cased with the punctuation dropped, and comparing anything else misses the duplicate.
    const manager = managerFor('US', []);

    await assertIdentity(manager, 'inv-7781/a', { id: 'sup-4', name: 'Supplier LLC', taxId: '12-3456789' });

    const duplicateQuery = manager.query.mock.calls.find((call) => String(call[0]).includes('vendor_bills'));
    expect(duplicateQuery?.[1]).toContain('INV7781A');
    expect(duplicateQuery?.[1]).toContain('123456789');
  });
});
