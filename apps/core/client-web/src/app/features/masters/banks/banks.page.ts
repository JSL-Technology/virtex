import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Trash2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { Bank, TreasuryService } from '../../../core/api/treasury.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VX_SORT, sortable } from '../../../shared/components/sort';

/**
 * The tenant's bank catalogue: the institutions it deals with.
 *
 * ## What this was
 *
 * First, four invented banks with their real SWIFT codes held in a signal. Then a list deduced
 * from the bank accounts — one row per distinct name typed into them — because the product kept no
 * banks at all: the same bank typed two ways was two banks, and a bank the company pays into
 * without holding an account there could not be recorded.
 *
 * It is a catalogue now (`/treasury/banks`), as a bank directory is in SAP and Odoo: name, BIC,
 * country and local clearing code, kept once. Bank accounts pick their institution from it, and a
 * renamed bank is renamed on every account held there.
 */
@Component({
  selector: 'app-banks-page',
  standalone: true,
  imports: [...VX_SORT, RouterLink, CanOpenDirective, LucideAngularModule, TranslateModule, ListShellComponent, VxBadgeComponent, ...FORMAT_PIPES],
  templateUrl: './banks.page.html',
  styleUrls: ['./banks.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BanksPage implements OnInit {
  private readonly treasury = inject(TreasuryService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly DeleteIcon = Trash2;

  readonly banks = signal<Bank[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.banks());

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.treasury.listBanks().subscribe({
      next: (banks) => {
        this.banks.set(banks);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'masters.banks.load_failed'));
        this.loading.set(false);
      },
    });
  }

  /** Refused by the server while an account is held there — the message says to deactivate. */
  async remove(bank: Bank): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'masters.banks.delete_title',
      message: 'masters.banks.delete_message',
      messageParams: { name: bank.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.busy.set(true);
    this.treasury.removeBank(bank.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess('masters.banks.deleted', { name: bank.name });
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(error, 'masters.banks.delete_failed');
      },
    });
  }
}
