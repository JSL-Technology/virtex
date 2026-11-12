import { cancellationRouteFor, cancellationCoverageFor } from './queries/documents';
import { marketCodes } from './registry';

/**
 * How an issued sales document is cancelled, per market (audit 2026-11-07, FAC-INV-05). The rule
 * belongs to each authority, so the test is a table of markets, not a Dominican example.
 */
describe('document cancellation routes', () => {
  const fiscal = (type: string) => ({ fiscalNumber: 'X0001', fiscalDocumentType: type });

  it('voids a document with no fiscal number, in every market: the authority never saw it', () => {
    for (const country of marketCodes()) {
      expect(cancellationRouteFor(country, { fiscalNumber: null })).toEqual({ kind: 'VOID' });
    }
  });

  it('Dominican Republic: a pre-printed comprobante is annulled and reported; an e-CF only by credit note', () => {
    expect(cancellationRouteFor('DO', fiscal('B01'))).toEqual({ kind: 'REPORT', reasonCatalogue: 'INVOICE_CANCELLATION' });
    expect(cancellationRouteFor('DO', fiscal('E31'))).toEqual({ kind: 'CREDIT_NOTE_ONLY' });
  });

  it('recognises a document whose type was not recorded by the mask of its number, never by guesswork', () => {
    // An e-CF stored before its type was: its number matches the catalogue's E31 mask.
    expect(cancellationRouteFor('DO', { fiscalNumber: 'E310000000123', fiscalDocumentType: null })).toEqual({ kind: 'CREDIT_NOTE_ONLY' });
    expect(cancellationRouteFor('DO', { fiscalNumber: 'B0100000123', fiscalDocumentType: null })).toEqual({ kind: 'REPORT', reasonCatalogue: 'INVOICE_CANCELLATION' });
    // Neither type nor a known mask: read as electronic, which is only ever reversed.
    expect(cancellationRouteFor('DO', { fiscalNumber: 'X-77', fiscalDocumentType: null })).toEqual({ kind: 'CREDIT_NOTE_ONLY' });
  });

  it.each(['CO', 'CL', 'AR'])('%s: an issued fiscal document is reversed with a credit note', (country) => {
    expect(cancellationRouteFor(country, fiscal('01'))).toEqual({ kind: 'CREDIT_NOTE_ONLY' });
  });

  it.each(['MX', 'BR', 'PE', 'EC'])('%s: cancellation is the authority’s event, not yet sent by the product', (country) => {
    expect(cancellationRouteFor(country, fiscal('01'))).toEqual({ kind: 'AUTHORITY_EVENT', implemented: false });
    expect(cancellationCoverageFor(country).implemented).toBe(false);
  });

  it('a fiscal document in a market whose rule is not stated is never voided: the credit note is always lawful', () => {
    expect(cancellationRouteFor('CR', fiscal('01'))).toEqual({ kind: 'CREDIT_NOTE_ONLY' });
    expect(cancellationRouteFor(null, fiscal('01'))).toEqual({ kind: 'CREDIT_NOTE_ONLY' });
  });
});
