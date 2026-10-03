// app/features/accounting/general-ledger/general-ledger.page.ts
import { Component, ChangeDetectionStrategy, signal, inject, OnInit, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, FileDown } from 'lucide-angular';
import { ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { GeneralLedgerLine, GeneralLedger as GeneralLedgerData } from '../../../core/models/general-ledger.model';
import { LedgersService } from '../../../core/api/ledgers.service';
import { NotificationService } from '../../../core/services/notification';
import { Observable } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxDateRangeComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { AccountingService } from '../../../core/api/accounting.service';
import { Account } from '../../../core/models/account.model';
import { ChartOfAccountsApiService } from '../data/chart-of-accounts.service';
import { StatementExportService } from '../../../core/export/statement-export.service';

@Component({
  selector: 'app-general-ledger-page',
  standalone: true,
  imports: [LucideAngularModule, FormsModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, ...VX_FORM_A11Y, VxAmountComponent, VxDateRangeComponent, ...VX_SELECT],
  templateUrl: './general-ledger.page.html',
  styleUrls: ['./general-ledger.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneralLedgerPage implements OnInit {
  //  Quedaban aquí nueve iconos de los que la plantilla usaba dos; los otros
  //  siete —UserCog, PowerOff, Ban, Trash2, Edit, Key, Calendar— venían de una
  //  pantalla de usuarios de la que se copió este archivo.
  protected readonly ExportIcon = FileDown;

  private ledgersService = inject(LedgersService);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  /** Optional: also reachable through the router outlet, where there is no tab to rename. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  private readonly accounting = inject(AccountingService);
  private readonly chartOfAccounts = inject(ChartOfAccountsApiService);
  private readonly exporter = inject(StatementExportService);

  /**
   * The account whose ledger is shown (QA A-13).
   *
   * It could only come from the URL, so «Libro Mayor» in the menu opened a page that said "no
   * account was specified" and offered no way to specify one: the ledger was reachable only by
   * clicking an account in the chart of accounts. The account is now chosen here, like the period.
   */
  readonly accountId = signal<string | null>(null);
  private readonly ledger = signal<GeneralLedgerData | null>(null);

  protected readonly searchAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounting.searchAccounts(query, limit);
  protected readonly resolveAccount = (id: string): Observable<Account> => this.chartOfAccounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountValue = (account: Account): string => account.id;

  selectedAccount = signal<{ code: string; name: string } | null>(null);
  ledgerLines = signal<GeneralLedgerLine[]>([]);
  initialBalance = signal(0);
  finalBalance = signal(0);
  loading = signal(false);

  readonly error = signal<string | null>(null);

  /**
   * Totales del periodo, derivados de las líneas.
   *
   * Estaban comentados y la plantilla imprimía el literal `0`, así que la pantalla afirmaba en cada
   * consulta que no había débitos ni créditos mientras dibujaba las líneas debajo. `?? 0` porque las
   * columnas decimales llegan como `null` cuando el movimiento es de un solo lado.
   */
  readonly totalDebits = computed(() =>
    this.ledgerLines().reduce((sum, line) => sum + Number(line.debit ?? 0), 0),
  );
  readonly totalCredits = computed(() =>
    this.ledgerLines().reduce((sum, line) => sum + Number(line.credit ?? 0), 0),
  );
  startDate: string;
  endDate: string;

  constructor() {
    const today = new Date();
    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    this.startDate = this.formatDate(firstDayOfMonth);
    this.endDate = this.formatDate(lastDayOfMonth);
  }

  ngOnInit(): void {
    this.accountId.set(this.route.snapshot.paramMap.get('accountId'));
    this.loadLedgerData();
  }

  selectAccount(id: string | null): void {
    this.accountId.set(id);
    this.loadLedgerData();
  }

  loadLedgerData(): void {
    const accountId = this.accountId();
    this.error.set(null);
    if (!accountId) {
      // Nothing chosen yet is a state, not an error: the selector above says what to do.
      this.ledger.set(null);
      this.selectedAccount.set(null);
      this.ledgerLines.set([]);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.ledgersService
      .getGeneralLedger(accountId, this.startDate, this.endDate)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (ledgerData: GeneralLedgerData) => {
          if (!ledgerData) return;
          this.ledger.set(ledgerData);
          this.selectedAccount.set(ledgerData.account);
          //  «Mayor · 1140 Inventario», no «Mayor · 3f2a19c4-…». El identificador de la cuenta en
          //  la URL es un UUID; el código y el nombre solo se conocen al responder el servidor.
          this.tab?.setTitle(
            `${this.translate.instant('page_titles.general_ledger')} · ` +
              `${ledgerData.account.code} ${accountNameOf(ledgerData.account.name)}`,
          );
          this.initialBalance.set(ledgerData.initialBalance);
          this.finalBalance.set(ledgerData.finalBalance);
          this.ledgerLines.set(ledgerData.lines);
        },
        // No había rama de error: un fallo del servidor dejaba la tabla vacía, que se lee como
        // «esta cuenta no tuvo movimientos» — la afirmación contraria a la verdad.
        error: (error: unknown) =>
          this.error.set(this.notificationService.httpErrorMessage(error, 'accounting.general_ledger.load_failed')),
      });
  }

  /** The ledger on screen, as a CSV (the button did nothing). */
  export(): void {
    const ledger = this.ledger();
    if (!ledger) return;
    this.exporter.exportGeneralLedger(ledger, this.startDate, this.endDate);
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
  }
}