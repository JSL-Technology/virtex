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
    supplier: { name: string; taxId?: string | null },
  ): Promise<void> => {
    const manager = { query: jest.fn(async () => [{ country }]) };
    return (service as unknown as {
      assertFiscalIdentity: (m: unknown, org: string, ncf: string | null, s: unknown) => Promise<void>;
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

  it('accepts a valid RNC or cédula', async () => {
    await expect(check('DO', 'B0100000001', { name: 'X', taxId: '130-86234-6' })).resolves.toBeUndefined();
  });

  it('does not apply without an NCF, or outside the Dominican Republic', async () => {
    await expect(check('DO', null, { name: 'Informal', taxId: null })).resolves.toBeUndefined();
    await expect(check('MX', 'A-123', { name: 'Proveedor MX', taxId: null })).resolves.toBeUndefined();
  });
});
