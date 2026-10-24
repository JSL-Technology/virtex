import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FormatService } from '@virteex/shared/ui-i18n';
import { AuthService } from './auth.service';
import { PosSale, ShiftReport } from './pos-api.service';
import { PrinterService } from './printer.service';
import {
  PrintFormat,
  ReceiptHeader,
  receiptHtml,
  shiftReportHtml,
} from '../domain/receipt';
import { TillStore } from '../state/till.store';

/** Tickets and shift reports, worded in the tenant's language and printed. */
@Injectable({ providedIn: 'root' })
export class DocumentsService {
  private readonly printer = inject(PrinterService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly auth = inject(AuthService);
  private readonly till = inject(TillStore);

  printReceipt(sale: PosSale): Promise<void> {
    return this.printer.print(
      receiptHtml(sale, this.header(), this.printFormat()),
    );
  }

  printReport(report: ShiftReport): Promise<void> {
    return this.printer.print(
      shiftReportHtml(report, this.header(), this.printFormat()),
    );
  }

  private header(): ReceiptHeader {
    return {
      context: this.till.context(),
      terminalId: this.till.terminalId(),
      cashier: this.auth.displayName(),
      branch: this.till.shiftBranchName(),
    };
  }

  private printFormat(): PrintFormat {
    const currency = this.till.currency();
    return {
      t: (key, params) => this.translate.instant(key, params),
      money: (value) => this.format.money(value, currency),
      dateTime: (value) => this.format.date(value, 'dateTime'),
      lang: this.translate.getCurrentLang() || 'es',
    };
  }
}
