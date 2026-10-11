import { DominicanRepublicFiscalAdapter } from './dominican-republic-fiscal.adapter';
import { ComplianceService } from '../../compliance/compliance.service';
import { Invoice } from '../entities/invoice.entity';
import { BadRequestError } from '../../i18n/localized.exception';
import type { EntityManager } from 'typeorm';

/**
 * Which comprobante a Dominican invoice is numbered as, in each series.
 *
 * Traditional NCF (B) and electronic e-CF (E) follow the same rule — crédito fiscal for a buyer
 * with a valid RNC or cédula, consumo otherwise — and the caller picks the series.
 */
describe('DominicanRepublicFiscalAdapter', () => {
  const getNextNcf = jest.fn(async (_org: string, type: string) => ({
    ncf: `${type}00000001`,
    type,
    expiresAt: '2027-12-31',
  }));
  const adapter = new DominicanRepublicFiscalAdapter({ getNextNcf } as unknown as ComplianceService);
  const manager = {} as EntityManager;

  const invoiceFor = (taxId: string | null) => ({ customerTaxId: taxId, customer: null }) as unknown as Invoice;
  const assign = (taxId: string | null, extra: { emissionKind?: 'ELECTRONIC' | 'TRADITIONAL'; requestedType?: string } = {}) =>
    adapter.assignSalesNumber({ invoice: invoiceFor(taxId), organizationId: 'org', manager, ...extra });

  beforeEach(() => getNextNcf.mockClear());

  it('issues electronic by default: E31 to a taxpayer, E32 to a consumer', async () => {
    expect((await assign('130456781')).documentType).toBe('E31');
    expect((await assign(null)).documentType).toBe('E32');
  });

  it('issues traditional NCF when the kind is traditional: B01 to a taxpayer, B02 to a consumer', async () => {
    expect((await assign('130456781', { emissionKind: 'TRADITIONAL' })).documentType).toBe('B01');
    expect((await assign(null, { emissionKind: 'TRADITIONAL' })).documentType).toBe('B02');
  });

  it('honours an explicitly requested type over the kind', async () => {
    expect((await assign(null, { emissionKind: 'ELECTRONIC', requestedType: 'B02' })).documentType).toBe('B02');
  });

  it('refuses a B01 without a valid RNC, as it always refused an E31', async () => {
    await expect(assign('123456789', { requestedType: 'B01' })).rejects.toBeInstanceOf(BadRequestError);
    await expect(assign(null, { requestedType: 'E31' })).rejects.toBeInstanceOf(BadRequestError);
    expect(getNextNcf).not.toHaveBeenCalled();
  });

  it('does not offer notes or buyer-issued comprobantes on an invoice', () => {
    const codes = adapter.availableSalesTypes().map((option) => option.code);
    expect(codes).toEqual(['B01', 'B02', 'B14', 'B15', 'B16', 'E31', 'E32', 'E44', 'E45', 'E46']);
    expect(adapter.availableSalesTypes().find((o) => o.code === 'B01')).toMatchObject({
      requiresBuyerTaxId: true,
      electronic: false,
    });
    expect(adapter.availableSalesTypes().find((o) => o.code === 'E32')).toMatchObject({
      requiresBuyerTaxId: false,
      electronic: true,
    });
  });

  it('credits a traditional invoice with a B04 and an electronic one with an E34', async () => {
    const credit = (original: string) =>
      adapter.assignCreditNoteNumber({
        invoice: invoiceFor(null),
        organizationId: 'org',
        manager,
        originalInvoice: { fiscalNumber: original } as Invoice,
      });
    expect((await credit('B0100000007')).documentType).toBe('B04');
    expect((await credit('E310000000007')).documentType).toBe('E34');
  });
});
