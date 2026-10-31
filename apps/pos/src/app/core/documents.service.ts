import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { FormatService } from '@virteex/shared/ui-i18n';
import { AuthService } from './auth.service';
import { firstValueFrom } from 'rxjs';
import { toDataURL } from 'qrcode';
import { PosApiService, PosFiscalStatus, PosSale, ShiftReport } from './pos-api.service';
import { PrinterService } from './printer.service';
import {
  PrintFormat,
  ReceiptFiscal,
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
  private readonly api = inject(PosApiService);

  async printReceipt(sale: PosSale): Promise<void> {
    const fiscal = await this.fiscalFor(sale);
    return this.printer.print(
      receiptHtml(sale, this.header(), this.printFormat(), fiscal),
    );
  }

  /**
   * The comprobante's block for the ticket. The e-NCF exists the moment the sale commits; the
   * security code and QR exist once it is signed, a second or two later, so this waits a little
   * for them. A document still unsigned after that prints with its e-NCF and says the code is
   * pending — the ticket can be reprinted from the journal once it is signed.
   */
  private async fiscalFor(sale: PosSale): Promise<ReceiptFiscal | null> {
    if (sale.status === 'PENDING_SYNC' || !sale.invoiceId) return null;
    let status: PosFiscalStatus | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        status = await firstValueFrom(this.api.fiscalStatus(sale.id));
      } catch {
        break;
      }
      if (status.securityCode || status.status === 'ERROR' || status.status === 'REJECTED') break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    const qrDataUri = status?.qrUrl
      ? await toDataURL(status.qrUrl, { margin: 0, width: 256, errorCorrectionLevel: 'M' }).catch(() => null)
      : null;
    return { status, qrDataUri };
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
