// app/features/accounting/general-ledger/general-ledger.page.ts
import { Component, ChangeDetectionStrategy, signal, inject, OnInit, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, FileDown } from 'lucide-angular';
import { ActivatedRoute } from '@angular/router';
import { finalize, switchMap } from 'rxjs/operators';
import { GeneralLedgerLine, GeneralLedger as GeneralLedgerData } from '../../../core/models/general-ledger.model';
import { LedgersService } from '../../../core/api/ledgers.service';
import { NotificationService } from '../../../core/services/notification';
import { EMPTY } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { ListShellComponent } from '../../../shared/components/gestures';

@Component({
  selector: 'app-general-ledger-page',
  standalone: true,
  imports: [LucideAngularModule, FormsModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
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

  selectedAccount = signal<{ code: string; name: string } | null>(null);
  ledgerLines = signal<GeneralLedgerLine[]>([]);
  initialBalance = signal(0);
  finalBalance = signal(0);
  loading = signal(true);

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
    this.loadLedgerData();
  }
  
  loadLedgerData(): void {
    this.loading.set(true);
    this.error.set(null);
    this.route.paramMap.pipe(
      switchMap(params => {
        const accountId = params.get('accountId');
        if (!accountId) {
          this.notificationService.showError('ACCOUNTING.GENERAL_LEDGER.HA_ESPECIFICADO_CUENTA');
          this.loading.set(false);
          return EMPTY;
        }
        return this.ledgersService.getGeneralLedger(accountId, this.startDate, this.endDate).pipe(
          finalize(() => this.loading.set(false))
        );
      })
    ).subscribe({
      next: (ledgerData: GeneralLedgerData) => {
        if (ledgerData) {
          this.selectedAccount.set(ledgerData.account);
          this.initialBalance.set(ledgerData.initialBalance);
          this.finalBalance.set(ledgerData.finalBalance);
          this.ledgerLines.set(ledgerData.lines);
        }
      },
      // No había rama de error: un fallo del servidor dejaba la tabla vacía, que se lee como
      // «esta cuenta no tuvo movimientos» — la afirmación contraria a la verdad.
      error: () => this.error.set('ACCOUNTING.GENERAL_LEDGER.LOAD_FAILED'),
    });
  }
  
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
  }
}