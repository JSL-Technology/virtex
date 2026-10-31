import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../core/services/notification';
import { saveFile } from '../../../core/api/data-transfer.service';

interface DeclarationLine {
  code: string;
  amount: number;
}

interface It1Worksheet {
  period: string;
  lines: DeclarationLine[];
  proportionalityFactor: number;
  payable: number;
  creditForward: number;
}

type DeclarationKind = 'it1' | 'ir17' | 'ir3';

/**
 * The Dominican monthly declarations the accountant fills in the DGII's Oficina Virtual: the IT-1
 * worked out box by box (so filing is transcription and it reconciles with the 606/607 already
 * sent), and the IR-17 and IR-3 as working papers to download.
 */
@Component({
  selector: 'app-dgii-declarations',
  standalone: true,
  imports: [FormsModule, ...VX_FORM_A11Y, TranslateModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card dd" aria-labelledby="dd-title">
      <h2 id="dd-title">{{ 'fiscal_returns.declarations.title' | translate }}</h2>
      <p class="fr-hint">{{ 'fiscal_returns.declarations.hint' | translate }}</p>
      <div class="dd-controls">
        <label for="dd-month">{{ 'fiscal_returns.period' | translate }}</label>
        <select id="dd-month" [ngModel]="month()" (ngModelChange)="month.set(+$event)">
          @for (m of months; track m) {
            <option [ngValue]="m">{{ m }}/{{ year() }}</option>
          }
        </select>
        <label for="dd-credit">{{ 'fiscal_returns.declarations.prior_credit' | translate }}</label>
        <input id="dd-credit" type="number" min="0" step="0.01" [ngModel]="priorCredit()" (ngModelChange)="priorCredit.set(+$event || 0)" />
        <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="computeIt1()">
          {{ 'fiscal_returns.declarations.compute_it1' | translate }}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="download('it1')">{{ 'fiscal_returns.declarations.download_it1' | translate }}</button>
        <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="download('ir17')">{{ 'fiscal_returns.declarations.download_ir17' | translate }}</button>
        <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="download('ir3')">{{ 'fiscal_returns.declarations.download_ir3' | translate }}</button>
      </div>
      @if (it1(); as sheet) {
        <table class="data-table">
          <tbody>
            @for (line of sheet.lines; track line.code) {
              <tr [class.total]="line.code.startsWith('it1.result')">
                <th scope="row">{{ labelKey(line.code) | translate }}</th>
                <td class="num">{{ line.amount | vxMoney: 'DOP' }}</td>
              </tr>
            }
            <tr>
              <th scope="row">{{ 'fiscal_returns.declarations.proportionality' | translate }}</th>
              <td class="num">{{ sheet.proportionalityFactor | vxPercent }}</td>
            </tr>
          </tbody>
        </table>
      }
    </section>
  `,
  styles: [
    `
      .dd { margin-top: 16px; padding: 16px; }
      .dd-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
      .dd-controls input { width: 140px; }
      tr.total th, tr.total td { font-weight: 700; }
    `,
  ],
})
export class DgiiDeclarationsComponent {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);

  readonly year = input.required<number>();
  readonly months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  readonly month = signal(new Date().getMonth() === 0 ? 12 : new Date().getMonth());
  readonly priorCredit = signal(0);
  readonly busy = signal(false);
  readonly it1 = signal<It1Worksheet | null>(null);

  /** `it1.sales.total` → `fiscal_returns.declarations.box.it1_sales_total`. */
  labelKey(code: string): string {
    return `fiscal_returns.declarations.box.${code.replace(/\./g, '_')}`;
  }

  computeIt1(): void {
    this.busy.set(true);
    this.http
      .get<It1Worksheet>(`${environment.apiUrl}/compliance/declarations/it1`, {
        params: { year: this.year(), month: this.month(), priorCredit: this.priorCredit() },
      })
      .subscribe({
        next: (sheet) => {
          this.it1.set(sheet);
          this.busy.set(false);
        },
        error: (err) => {
          this.busy.set(false);
          this.notifications.showHttpError(err, 'fiscal_returns.declarations.error');
        },
      });
  }

  download(kind: DeclarationKind): void {
    const url =
      kind === 'ir3'
        ? `${environment.apiUrl}/payroll/declarations/ir3`
        : `${environment.apiUrl}/compliance/declarations/${kind}`;
    this.busy.set(true);
    this.http
      .get(url, {
        params: { year: this.year(), month: this.month(), format: 'csv', ...(kind === 'it1' ? { priorCredit: this.priorCredit() } : {}) },
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => {
          this.busy.set(false);
          saveFile({ fileName: `DGII_${kind.toUpperCase()}_${this.year()}${String(this.month()).padStart(2, '0')}.csv`, blob });
        },
        error: (err) => {
          this.busy.set(false);
          this.notifications.showHttpError(err, 'fiscal_returns.declarations.error');
        },
      });
  }
}
