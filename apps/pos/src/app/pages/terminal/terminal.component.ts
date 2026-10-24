import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  LucideAngularModule,
  ReceiptText,
  ClipboardList,
  Settings,
  Maximize,
  Minimize,
  LogOut,
  Building2,
  Wifi,
  WifiOff,
  Store,
} from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth.service';
import { ConnectivityService } from '../../core/connectivity.service';
import { DocumentsService } from '../../core/documents.service';
import { PosSale } from '../../core/pos-api.service';
import { TerminalConfigService } from '../../core/terminal-config.service';
import { TillStore } from '../../state/till.store';
import { CatalogPanelComponent } from './components/catalog-panel.component';
import { JournalDialogComponent } from './components/journal-dialog.component';
import { ParkedDialogComponent } from './components/parked-dialog.component';
import { PaymentDialogComponent } from './components/payment-dialog.component';
import { ReceiptDialogComponent } from './components/receipt-dialog.component';
import { SettingsDialogComponent } from './components/settings-dialog.component';
import { ShiftDialogComponent } from './components/shift-dialog.component';
import { TicketPanelComponent } from './components/ticket-panel.component';
import { ToastsComponent } from './components/toasts.component';

type Dialog =
  'payment' | 'receipt' | 'shift' | 'journal' | 'settings' | 'parked' | null;

/**
 * The till: one full-screen surface — catalogue on the left, ticket on the right, the whole
 * sell/charge loop without navigating away, every frequent action on a function key.
 *
 * This is the point of sale *application*, separate from the ERP: it is deployed on its own, signs
 * in with the same accounts (whoever's role carries `pos:view`), and links back to the ERP for the
 * back office. It merges what used to be two tills — the ERP's embedded screen (payment dialog,
 * change, receipt, customer, product pictures, tax shown at its rate) and this application (sign-in
 * with a second factor, idempotent sales, branch choice, cash-up against the counted drawer).
 */
@Component({
  selector: 'pos-terminal',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslateModule,
    ...FORMAT_PIPES,
    CatalogPanelComponent,
    TicketPanelComponent,
    PaymentDialogComponent,
    ReceiptDialogComponent,
    ShiftDialogComponent,
    JournalDialogComponent,
    SettingsDialogComponent,
    ParkedDialogComponent,
    ToastsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './terminal.component.html',
  styleUrl: './terminal.component.scss',
})
export class TerminalComponent {
  protected readonly till = inject(TillStore);
  protected readonly auth = inject(AuthService);
  protected readonly connectivity = inject(ConnectivityService);
  private readonly config = inject(TerminalConfigService);
  private readonly documents = inject(DocumentsService);
  private readonly router = inject(Router);

  private readonly catalog = viewChild(CatalogPanelComponent);

  protected readonly erpUrl = environment.erpUrl;
  protected readonly icons = {
    journal: ReceiptText,
    shift: ClipboardList,
    settings: Settings,
    maximize: Maximize,
    minimize: Minimize,
    logout: LogOut,
    erp: Building2,
    online: Wifi,
    offline: WifiOff,
    brand: Store,
  };

  protected readonly dialog = signal<Dialog>(null);
  protected readonly fullscreen = signal(false);
  protected readonly now = signal(new Date());
  protected readonly organization = computed(
    () =>
      this.till.context()?.organization.legalName ||
      this.auth.user()?.organization?.legalName ||
      '',
  );

  constructor() {
    this.till.init();
    const clock = setInterval(() => this.now.set(new Date()), 30_000);
    const onFullscreen = () =>
      this.fullscreen.set(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFullscreen);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      document.removeEventListener('fullscreenchange', onFullscreen);
    });
  }

  protected open(dialog: Exclude<Dialog, null>): void {
    if (
      dialog === 'payment' &&
      (this.till.lines().length === 0 || !this.till.canSell())
    )
      return;
    if ((dialog === 'shift' || dialog === 'journal') && !this.till.shift())
      return;
    this.dialog.set(dialog);
  }

  protected closeDialog(): void {
    this.dialog.set(null);
    // Back to the search box: the next scan must land in it.
    queueMicrotask(() => this.catalog()?.focusSearch());
  }

  protected saleCompleted(sale: PosSale): void {
    this.dialog.set('receipt');
    if (this.config.autoPrint()) void this.documents.printReceipt(sale);
  }

  protected newSale(): void {
    this.till.lastSale.set(null);
    this.closeDialog();
  }

  protected toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement.requestFullscreen?.().catch(() => void 0);
  }

  protected logout(): void {
    this.auth
      .logout()
      .subscribe(() => void this.router.navigateByUrl('/login'));
  }

  /**
   * Function keys, so a cashier with a scanner in one hand never reaches for the mouse. Only while
   * no dialog is open — inside one, Enter and Escape belong to the dialog.
   */
  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    if (this.dialog()) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    const selected = this.till.selectedId();
    switch (event.key) {
      case 'F2':
        event.preventDefault();
        this.catalog()?.focusSearch();
        return;
      case 'F4':
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>('[data-testid="pos-customer"]')
          ?.focus();
        return;
      case 'F6':
        event.preventDefault();
        this.open('journal');
        return;
      case 'F7':
        event.preventDefault();
        this.open('shift');
        return;
      case 'F8':
        event.preventDefault();
        this.till.park();
        return;
      case 'F9':
        event.preventDefault();
        this.open('payment');
        return;
    }
    if (typing || !selected) return;
    if (event.key === '+') {
      event.preventDefault();
      this.till.increment(selected, 1);
    } else if (event.key === '-') {
      event.preventDefault();
      this.till.increment(selected, -1);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      this.till.remove(selected);
    }
  }
}
