import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { LucideAngularModule, Landmark } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

import { ListShellComponent } from '../../../shared/components/gestures';
import { PAYMENT_FORMS } from '../../../core/services/accounts-payable';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { VX_SORT, sortable } from '../../../shared/components/sort';

/**
 * The forms of payment a fiscal document may declare.
 *
 * ## What this replaces
 *
 * Three invented rows — Efectivo, Transferencia, Tarjeta — with a "default method" flag the product
 * has nowhere to store, held in a signal and fetched from nothing, behind a "New method" button
 * wired to nothing.
 *
 * This is not tenant data and never was: the DGII fixes the payment forms an e-CF may carry, 01 to
 * 07, and the invoice and vendor bill forms already post those codes. A tenant cannot add an eighth
 * one, so the screen shows the catalogue that actually governs the documents, and says where it
 * comes from instead of offering to edit it. `PAYMENT_FORMS` is the same constant those forms use,
 * so this screen cannot drift from what the documents accept.
 */
@Component({
  selector: 'app-payment-methods-page',
  standalone: true,
  imports: [...VX_SORT, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './payment-methods.page.html',
  styleUrls: ['./payment-methods.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentMethodsPage {
  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.methods, { name: (method) => this.translate.instant(method.labelKey) });
  protected readonly BankIcon = Landmark;
  private readonly locale = inject(LocaleStore);

  readonly methods = PAYMENT_FORMS;
  readonly countryCode = this.locale.tenantContext()?.countryCode ?? 'DO';
}
