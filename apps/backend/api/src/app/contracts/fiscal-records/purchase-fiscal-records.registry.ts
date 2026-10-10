import { Injectable } from '@nestjs/common';
import { InternalServerError } from '../../i18n/localized.exception';
import { PurchaseFiscalRecordsSource } from './purchase-fiscal-records.contract';

/**
 * Where the purchases source registers itself, so Compliance can ask without importing it.
 *
 * One source, not a list: purchases have one owner, and two answers to «which bills were received
 * this month» would mean a return counted twice. A second registration under another name is a
 * wiring mistake and is refused loudly.
 */
@Injectable()
export class PurchaseFiscalRecordsRegistry {
  private registered: PurchaseFiscalRecordsSource | null = null;

  register(source: PurchaseFiscalRecordsSource): void {
    if (this.registered && this.registered.sourceName !== source.sourceName) {
      throw new Error(
        `Purchase fiscal records already answered by «${this.registered.sourceName}»; refusing «${source.sourceName}».`,
      );
    }
    this.registered = source;
  }

  reset(): void {
    this.registered = null;
  }

  /** The registered source. Its absence is a deployment without Purchasing, said as such. */
  source(): PurchaseFiscalRecordsSource {
    if (!this.registered) throw new InternalServerError('compliance.purchase_records_unavailable');
    return this.registered;
  }
}
