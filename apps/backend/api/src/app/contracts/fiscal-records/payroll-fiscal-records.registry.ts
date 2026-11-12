import { Injectable } from '@nestjs/common';
import { InternalServerError } from '../../i18n/localized.exception';
import { PayrollFiscalRecordsSource } from './payroll-fiscal-records.contract';

/**
 * Where payroll registers itself, so a return can ask without importing it.
 *
 * One source, like the purchases one: two answers to «what was paid this month» would mean a
 * filing that declares the same contribution twice.
 */
@Injectable()
export class PayrollFiscalRecordsRegistry {
  private registered: PayrollFiscalRecordsSource | null = null;

  register(source: PayrollFiscalRecordsSource): void {
    if (this.registered && this.registered.sourceName !== source.sourceName) {
      throw new Error(
        `Payroll fiscal records already answered by «${this.registered.sourceName}»; refusing «${source.sourceName}».`,
      );
    }
    this.registered = source;
  }

  reset(): void {
    this.registered = null;
  }

  /** The registered source. Its absence is a deployment without payroll, said as such. */
  source(): PayrollFiscalRecordsSource {
    if (!this.registered) throw new InternalServerError('compliance.payroll_records_unavailable');
    return this.registered;
  }
}
