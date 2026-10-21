import { checkReceivedDocument, nfeCheckDigitOk, receivedDocumentKind } from './received-document';

describe('the number on a supplier document, by market', () => {
  it('knows which number each market prints', () => {
    expect(receivedDocumentKind('DO')).toBe('NCF');
    expect(receivedDocumentKind('MX')).toBe('CFDI_UUID');
    expect(receivedDocumentKind('BR')).toBe('NFE_KEY');
    expect(receivedDocumentKind('CO')).toBe('CUFE');
    expect(receivedDocumentKind('US')).toBe('INVOICE_NUMBER');
    expect(receivedDocumentKind(null)).toBe('INVOICE_NUMBER');
  });

  it('checks an NCF only in the Dominican Republic', () => {
    expect(checkReceivedDocument('DO', 'b01-00000123')).toMatchObject({ status: 'ok', normalized: 'B0100000123', type: 'B01' });
    expect(checkReceivedDocument('DO', 'B01-123')).toMatchObject({ status: 'invalid', error: 'format' });
    // The same text in the US is just an invoice number, kept and marked unverified.
    expect(checkReceivedDocument('US', 'B01-123')).toMatchObject({ status: 'unverified', normalized: 'B01-123' });
  });

  it('checks a Brazilian access key by its check digit', () => {
    const base = '3523080000000000000155001000000001100000001';
    const valid = [...Array(10).keys()].map((digit) => `${base}${digit}`).find(nfeCheckDigitOk)!;
    expect(checkReceivedDocument('BR', valid.replace(/(\d{4})/g, '$1 '))).toMatchObject({ status: 'ok', normalized: valid });
    const wrong = `${base}${(Number(valid[43]) + 1) % 10}`;
    expect(checkReceivedDocument('BR', wrong)).toMatchObject({ status: 'invalid', error: 'check_digit' });
  });

  it('says what is missing rather than inventing it', () => {
    expect(checkReceivedDocument('MX', '  ')).toMatchObject({ status: 'missing', normalized: null });
  });
});
