import { Module } from '@nestjs/common';
import { EinvoicingModule } from '../../einvoicing/einvoicing.module';
import { FiscalAdapterFactory } from './fiscal-adapter.factory';

/**
 * The fiscal numbering engine, on its own: one adapter per market, guided by the market's declared
 * numbering (`markets/<cc>/documents.ts`), drawing from the tenant's ranges (`FiscalRangeService`).
 *
 * Separate from `InvoicesModule` because the till numbers its receipts with the same engine, and a
 * till that imported the whole invoicing module to draw one number would carry e-mail, the ledger
 * and the e-invoicing outbox along with it.
 */
@Module({
  // The company's market and fiscal data come through the organization's fiscal-identity contract,
  // so the engine registers no entity of another module.
  imports: [EinvoicingModule],
  providers: [FiscalAdapterFactory],
  exports: [FiscalAdapterFactory],
})
export class FiscalNumberingModule {}
