import { FiscalAdapterFactory } from './fiscal-adapter.factory';
import { GenericFiscalAdapter } from './generic-fiscal.adapter';
import { DominicanRepublicFiscalAdapter } from './dominican-republic-fiscal.adapter';
import {
  ArgentinaNumberingAdapter,
  BrazilNumberingAdapter,
  ChileNumberingAdapter,
  ColombiaNumberingAdapter,
  EcuadorNumberingAdapter,
  MexicoNumberingAdapter,
  PeruNumberingAdapter,
} from './regime-numbering.adapter';
import { coverageFor, marketCodes } from '../../markets';

/**
 * What Settings › coverage says about debit notes in each market is what the market's invoice
 * adapter does (audit 2026-11-07, FAC-INV-05): an adapter that can number one ⇔ «implemented».
 * Without this the two would drift, and a Colombian company would be promised a debit note the
 * server refuses — or worse, sent one its builder writes as an invoice.
 */
describe('debit notes: the adapters and the coverage declare the same thing', () => {
  const shell = <T>(type: new (...args: never[]) => T): T => Object.create(type.prototype) as T;
  const factory = new FiscalAdapterFactory(
    shell(GenericFiscalAdapter),
    shell(DominicanRepublicFiscalAdapter),
    shell(MexicoNumberingAdapter),
    shell(ColombiaNumberingAdapter),
    shell(PeruNumberingAdapter),
    shell(EcuadorNumberingAdapter),
    shell(ChileNumberingAdapter),
    shell(BrazilNumberingAdapter),
    shell(ArgentinaNumberingAdapter),
    {} as never,
  );

  it.each([...marketCodes()])('%s', (country) => {
    const adapterIssues = typeof factory.forCountry(country).assignDebitNoteNumber === 'function';
    const declared = coverageFor(country).capabilities.find((c) => c.capability === 'debitNotes')?.level;
    expect(declared).toBe(adapterIssues ? 'implemented' : 'not-implemented');
  });
});
