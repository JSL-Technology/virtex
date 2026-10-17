import { checkReceivedNcf } from './ncf';

describe('checkReceivedNcf', () => {
  it('accepts the two shapes the DGII issues, however they were typed', () => {
    expect(checkReceivedNcf('b0100000123')).toMatchObject({ ok: true, ncf: { normalized: 'B0100000123', type: 'B01', electronic: false } });
    expect(checkReceivedNcf('E31 0000 000 123')).toMatchObject({ ok: true, ncf: { normalized: 'E310000000123', type: 'E31', electronic: true } });
  });

  it('refuses a malformed number and a type the DGII does not define', () => {
    expect(checkReceivedNcf('B010000012')).toMatchObject({ ok: false, error: 'format' });
    expect(checkReceivedNcf('E3100000001')).toMatchObject({ ok: false, error: 'format' }); // an E with eight digits
    expect(checkReceivedNcf('B9900000001')).toMatchObject({ ok: false, error: 'unknown_type' });
  });

  it('warns about what is valid but unusual on a purchase', () => {
    expect(checkReceivedNcf('B0200000001')).toMatchObject({ ok: true, ncf: { warnings: ['no_tax_credit'] } });
    expect(checkReceivedNcf('B0400000001')).toMatchObject({ ok: true, ncf: { warnings: ['credit_note_on_bill'] } });
  });

  it('knows which comprobantes need no supplier RNC: minor expenses and payments abroad', () => {
    for (const ncf of ['B1300000001', 'E430000000001', 'B1700000001', 'E470000000001']) {
      expect(checkReceivedNcf(ncf)).toMatchObject({ ok: true, ncf: { requiresSupplierTaxId: false, selfIssued: true } });
    }
    expect(checkReceivedNcf('B1100000001')).toMatchObject({ ok: true, ncf: { requiresSupplierTaxId: true, selfIssued: true } });
    expect(checkReceivedNcf('B0100000001')).toMatchObject({ ok: true, ncf: { requiresSupplierTaxId: true, selfIssued: false } });
  });
});
