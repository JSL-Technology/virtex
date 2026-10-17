import { AccountsPayableService } from './accounts-payable.service';

/**
 * QA B-02: a vendor bill with a Dominican NCF names a supplier the DGII can identify. The 606
 * reports each purchase against the supplier's RNC or cédula and rejects a line without one.
 */
describe('A vendor bill with an NCF needs the supplier’s RNC', () => {
  const service = Object.create(AccountsPayableService.prototype) as AccountsPayableService;
  const check = (
    country: string | null,
    ncf: string | null,
    supplier: { id?: string; name: string; taxId?: string | null },
    existing: Array<{ id: string }> = [],
  ): Promise<string | null> => {
    const manager = {
      query: jest.fn(async (sql: string) => (sql.includes('organizations') ? [{ country }] : sql.includes('vendor_bills') ? existing : [])),
    };
    return (service as unknown as {
      assertFiscalIdentity: (m: unknown, org: string, ncf: string | null, s: unknown) => Promise<string | null>;
    }).assertFiscalIdentity(manager, 'org-1', ncf, supplier);
  };

  it('refuses a Dominican NCF from a supplier with no tax id', async () => {
    await expect(check('DO', 'B0100000001', { name: 'Sin RNC SRL', taxId: null })).rejects.toMatchObject({
      messageKey: 'accounts_payable.ncf_requires_supplier_tax_id',
      params: { supplier: 'Sin RNC SRL', ncf: 'B0100000001' },
    });
  });

  it('refuses a mistyped RNC: checked by its check digit, not by being present', async () => {
    await expect(check('DO', 'B0100000001', { name: 'X', taxId: '130862347' })).rejects.toBeDefined();
  });

  it('accepts a valid RNC or cédula, and returns the number as the DGII writes it', async () => {
    await expect(check('DO', 'b01-0000-0001', { name: 'X', taxId: '130-86234-6' })).resolves.toBe('B0100000001');
  });

  it('does not apply without an NCF, or outside the Dominican Republic', async () => {
    await expect(check('DO', null, { name: 'Informal', taxId: null })).resolves.toBeNull();
    await expect(check('MX', 'A-123', { name: 'Proveedor MX', taxId: null })).resolves.toBeNull();
  });

  it('refuses a malformed NCF and an unknown comprobante type', async () => {
    await expect(check('DO', 'B01-123', { name: 'X', taxId: '130862346' })).rejects.toMatchObject({ messageKey: 'accounts_payable.ncf_invalid_format' });
    await expect(check('DO', 'B9900000001', { name: 'X', taxId: '130862346' })).rejects.toMatchObject({ messageKey: 'accounts_payable.ncf_unknown_type' });
  });

  it('needs no supplier RNC for minor expenses or a payment abroad, which the company issues itself', async () => {
    await expect(check('DO', 'B1300000001', { name: 'Colmado', taxId: null })).resolves.toBe('B1300000001');
    await expect(check('DO', 'B1700000001', { name: 'AWS', taxId: null })).resolves.toBe('B1700000001');
  });

  it('refuses the same NCF from the same supplier on a second live bill', async () => {
    await expect(check('DO', 'B0100000001', { id: 'sup-1', name: 'X', taxId: '130862346' }, [{ id: 'bill-1' }])).rejects.toMatchObject({
      messageKey: 'accounts_payable.ncf_already_recorded',
    });
  });
});
