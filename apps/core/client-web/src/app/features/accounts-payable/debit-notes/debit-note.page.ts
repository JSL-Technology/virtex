import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Ban, LucideAngularModule } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { DocumentShellComponent } from '../../../shared/components/gestures';
import { VxAmountComponent } from '../../../shared/components/amount';
import { VxBranchLabelComponent } from '../../../shared/components/branch-picker';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { AccountsPayableService, VendorDebitNote } from '../../../core/services/accounts-payable';
import { DEBIT_NOTE_TONE } from './debit-notes.page';

/** One debit note, read, with its entry — and its void, the only correction a posted note takes. */
@Component({
  selector: 'app-vendor-debit-note-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, DocumentShellComponent, VxAmountComponent, VxBranchLabelComponent, HasPermissionDirective],
  templateUrl: './debit-note.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorDebitNotePage implements OnInit {
  private readonly payables = inject(AccountsPayableService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  protected readonly branches = inject(BranchesService);

  readonly id = input.required<string>();

  protected readonly VoidIcon = Ban;

  readonly note = signal<VendorDebitNote | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly tone = computed(() => DEBIT_NOTE_TONE[this.note()?.status ?? 'POSTED']);
  readonly canVoid = computed(() => this.note()?.status === 'POSTED' && this.note()?.vendorBill?.status !== 'VOID');

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.payables.debitNote(this.id()).subscribe({
      next: (note) => {
        this.note.set(note);
        this.tab?.setTitle(note.number);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'accounts_payable.debit_notes.load_one_failed'));
        this.loading.set(false);
      },
    });
  }

  entryLink(entryId: string | null | undefined): string | null {
    return entryId ? this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`) : null;
  }

  async voidNote(): Promise<void> {
    const note = this.note();
    if (!note) return;
    const reason = await this.dialog.prompt({
      title: 'accounts_payable.debit_notes.void_title',
      message: 'accounts_payable.debit_notes.void_message',
      messageParams: { number: note.number },
      placeholder: 'accounts_payable.debit_notes.void_reason',
      minLength: 3,
      tooShort: 'accounts_payable.debit_notes.void_reason_too_short',
      variant: 'danger',
    });
    if (!reason) return;
    this.busy.set(true);
    this.payables.voidDebitNote(note.id, reason).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess('accounts_payable.debit_notes.voided', { number: note.number });
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(error, 'accounts_payable.debit_notes.void_failed');
      },
    });
  }

  goToList(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounts-payable/debit-notes'));
  }
}
