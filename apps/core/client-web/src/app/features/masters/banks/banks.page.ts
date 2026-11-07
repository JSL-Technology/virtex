import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Landmark, LucideAngularModule, PlusCircle, Trash2 } from 'lucide-angular';

import { ListShellComponent } from '../../../shared/components/gestures';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { Bank, ReferenceBanksStatus, TreasuryService } from '../../../core/api/treasury.service';
import { CountryNamesService } from '../../../core/i18n/countries';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VX_SORT, sortable } from '../../../shared/components/sort';

import { VX_TABLE } from '../../../shared/components/table';
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
 *
 * Where the product ships the regulator's list for the company's country (the Dominican Republic
 * today), the page offers to add the institutions the catalogue lacks: one click instead of typing
 * forty banks, and only BICs an official source confirms. It adds, it never overwrites.
 */
@Component({
  selector: 'app-banks-page',
  standalone: true,
  imports: [...VX_TABLE, ...VX_SORT, RouterLink, HasPermissionDirective, CanOpenDirective, LucideAngularModule, TranslateModule, ListShellComponent, VxBadgeComponent, ...FORMAT_PIPES],
  templateUrl: './banks.page.html',
  styleUrls: ['./banks.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BanksPage implements OnInit {
  private readonly treasury = inject(TreasuryService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly countryNames = inject(CountryNamesService);

  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly DeleteIcon = Trash2;
  protected readonly ImportIcon = Landmark;

  readonly banks = signal<Bank[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  /** What the official list for the company's country would add; null until known or when absent. */
  readonly reference = signal<ReferenceBanksStatus | null>(null);
  readonly importing = signal(false);
  /** «República Dominicana», in the reader's language. */
  readonly referenceCountry = computed(() => this.countryNames.nameOf(this.reference()?.country));
  readonly canImport = computed(() => (this.reference()?.missing ?? 0) > 0);

  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.banks());

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadReference();
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

  /** Whether there is an official list to import from; a failure only hides the offer. */
  loadReference(): void {
    this.treasury.referenceBanks().subscribe({
      next: (status) => this.reference.set(status.available > 0 ? status : null),
      error: () => this.reference.set(null),
    });
  }

  importReference(): void {
    if (this.importing()) return;
    this.importing.set(true);
    this.treasury.importReferenceBanks().subscribe({
      next: (result) => {
        this.importing.set(false);
        if (result.added > 0) {
          this.notifications.showSuccess('masters.banks.reference_imported', {
            count: result.added,
            country: this.countryNames.nameOf(result.country),
          });
        } else {
          this.notifications.showInfo('masters.banks.reference_up_to_date');
        }
        this.load();
      },
      error: (error: unknown) => {
        this.importing.set(false);
        this.notifications.showHttpError(error, 'masters.banks.reference_import_failed');
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
