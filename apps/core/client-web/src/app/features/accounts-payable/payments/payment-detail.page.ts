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
import { AccountsPayableService, PaymentBatch } from '../../../core/services/accounts-payable';
import { PAYMENT_TONE } from './payments.page';

/**
 * One payment to suppliers, read: the account it left, every bill it settled — cash, withholding,
 * discount, exchange difference — and the entry. Voiding it (a cheque returned, a transfer
 * rejected) gives each bill back what it settled and reverses the entry; the bank refuses it once
 * the payment has been matched on a statement, which is the right answer.
 */
@Component({
  selector: 'app-vendor-payment-detail-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, DocumentShellComponent, VxAmountComponent, VxBranchLabelComponent, HasPermissionDirective],
  templateUrl: './payment-detail.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorPaymentDetailPage implements OnInit {
  private readonly payables = inject(AccountsPayableService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  protected readonly branches = inject(BranchesService);

  readonly id = input.required<string>();

  protected readonly VoidIcon = Ban;

  readonly payment = signal<PaymentBatch | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly tone = computed(() => PAYMENT_TONE[this.payment()?.status ?? 'PAID']);
  readonly canVoid = computed(() => this.payment()?.status === 'PAID');
  readonly totalPaid = computed(() =>
    Math.round((this.payment()?.payments ?? []).reduce((sum, line) => sum + Number(line.amountPaid), 0) * 100) / 100,
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.payables.payment(this.id()).subscribe({
      next: (payment) => {
        this.payment.set(payment);
        this.tab?.setTitle(payment.number);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'accounts_payable.payments.load_one_failed'));
        this.loading.set(false);
      },
    });
  }

  entryLink(entryId: string | null | undefined): string | null {
    return entryId ? this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`) : null;
  }

  async voidPayment(): Promise<void> {
    const payment = this.payment();
    if (!payment) return;
    const reason = await this.dialog.prompt({
      title: 'accounts_payable.payments.void_title',
      message: 'accounts_payable.payments.void_message',
      messageParams: { number: payment.number },
      placeholder: 'accounts_payable.payments.void_reason',
      minLength: 3,
      tooShort: 'accounts_payable.payments.void_reason_too_short',
      variant: 'danger',
    });
    if (!reason) return;
    this.busy.set(true);
    this.payables.voidPayment(payment.id, reason).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess('accounts_payable.payments.voided', { number: payment.number });
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(error, 'accounts_payable.payments.void_failed');
      },
    });
  }

  goToList(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/accounts-payable/payments'));
  }
}
