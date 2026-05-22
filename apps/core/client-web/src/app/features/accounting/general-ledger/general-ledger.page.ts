// app/features/accounting/general-ledger/general-ledger.page.ts
import { Component, ChangeDetectionStrategy, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Filter, FileDown, Calendar, UserCog, PowerOff, Ban, Trash2, Edit, Key } from 'lucide-angular';
import { ActivatedRoute } from '@angular/router';
import { finalize, switchMap } from 'rxjs/operators';
import { GeneralLedgerLine, GeneralLedger as GeneralLedgerData } from '../../../core/models/general-ledger.model';
import { LedgersService } from '../../../core/api/ledgers.service';
import { NotificationService } from '../../../core/services/notification';
import { EMPTY } from 'rxjs';

@Component({
  selector: 'app-general-ledger-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, FormsModule],
  templateUrl: './general-ledger.page.html',
  styleUrls: ['./general-ledger.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneralLedgerPage implements OnInit {
  protected readonly FilterIcon = Filter;
  protected readonly ExportIcon = FileDown;
  protected readonly CalendarIcon = Calendar;
  protected readonly UserCogIcon = UserCog;
  protected readonly PowerOffIcon = PowerOff;
  protected readonly BanIcon = Ban;
  protected readonly TrashIcon = Trash2;
  protected readonly EditIcon = Edit;
  protected readonly KeyIcon = Key;

  private ledgersService = inject(LedgersService);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  selectedAccount = signal<{ code: string; name: string } | null>(null);
  ledgerLines = signal<GeneralLedgerLine[]>([]);
  initialBalance = signal(0);
  finalBalance = signal(0);
  loading = signal(true);

  // totalDebits = computed(() => this.ledgerLines().reduce((acc, line) => acc + line.debit, 0));
  // totalCredits = computed(() => this.ledgerLines().reduce((acc, line) => acc + line.credit, 0));
  
  totalDebits = 0;
  totalCredits = 0;
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
    this.route.paramMap.pipe(
      switchMap(params => {
        const accountId = params.get('accountId');
        if (!accountId) {
          this.notificationService.showError('No se ha especificado una cuenta.');
          this.loading.set(false);
          return EMPTY;
        }
        return this.ledgersService.getGeneralLedger(accountId, this.startDate, this.endDate).pipe(
          finalize(() => this.loading.set(false))
        );
      })
    ).subscribe((ledgerData: GeneralLedgerData) => {
      if (ledgerData) {
        this.selectedAccount.set(ledgerData.account);
        this.initialBalance.set(ledgerData.initialBalance);
        this.finalBalance.set(ledgerData.finalBalance);
        this.ledgerLines.set(ledgerData.lines);
      }
    });
  }
  
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
  }
}