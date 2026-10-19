import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';

import { ListShellComponent } from '../../../shared/components/gestures';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../core/services/notification';
import { CountryPackService } from '../../../core/api/country-pack.service';
import {
  PaymentMethodRow,
  PaymentMethodsService,
  SETTLEMENT_KINDS,
} from '../../../core/api/payment-methods.service';
import type { PaymentMethod as SettlementKind } from '../../../core/services/invoices';

/**
 * The company's payment methods.
 *
 * ## What this was
 *
 * First three invented rows held in a signal, behind a «New method» button wired to nothing. Then
 * the DGII's 606 catalogue, 01 to 07, shown to every company in every market under «Fixed by the
 * DGII for fiscal documents; they are not added or edited» — true in the Dominican Republic, and the
 * reason a US company could not record ACH, a wire or Zelle (QA C-06).
 *
 * The list is the company's own now (`/treasury/payment-methods`), seeded per market. Whether the
 * company may shape it is the market's answer, from its country pack: where the authority fixes the
 * catalogue the screen shows it read-only and names the authority; everywhere else a method is
 * added, renamed, re-mapped to the authority's code, retired and reinstated here. Never deleted:
 * a document that recorded `ZELLE` must still say what it was paid with.
 */
@Component({
  selector: 'app-payment-methods-page',
  standalone: true,
  imports: [
    ...VX_SORT,
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule,
    ListShellComponent,
    VxBadgeComponent,
    HasPermissionDirective,
  ],
  templateUrl: './payment-methods.page.html',
  styleUrls: ['./payment-methods.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentMethodsPage implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly api = inject(PaymentMethodsService);
  private readonly notifications = inject(NotificationService);
  private readonly countryPack = inject(CountryPackService);
  private readonly fb = inject(FormBuilder);

  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly kinds = SETTLEMENT_KINDS;

  readonly methods = signal<PaymentMethodRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  /** `'new'`, a method's id while it is edited, or null. One editor at a time. */
  readonly editing = signal<string | null>(null);

  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.methods(), {
    kind: (method) => this.translate.instant(this.kindLabel(method.kind)),
  });

  /** The authority fixes the list in this market: read-only, and the screen says whose it is. */
  readonly fixed = computed(() => this.countryPack.pack()?.paymentMethods.catalogue === 'AUTHORITY_FIXED');
  readonly authority = computed(() => this.countryPack.pack()?.paymentMethods.authority ?? '');
  /** Editable only once the pack says so: an unknown market is not offered an edit it may refuse. */
  readonly editable = computed(() => this.countryPack.pack()?.paymentMethods.catalogue === 'EDITABLE');

  readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.maxLength(20), Validators.pattern(/^[A-Za-z0-9_-]+$/)]],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    kind: ['BANK_TRANSFER' as SettlementKind, Validators.required],
    fiscalCode: ['', Validators.maxLength(10)],
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (rows) => {
        this.methods.set(rows);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(err, 'masters.payment_methods.load_failed'));
        this.loading.set(false);
      },
    });
  }

  kindLabel(kind: SettlementKind): string {
    return this.kinds.find((entry) => entry.value === kind)?.labelKey ?? kind;
  }

  startNew(): void {
    this.form.reset({ code: '', name: '', kind: 'BANK_TRANSFER', fiscalCode: '' });
    this.form.controls.code.enable();
    this.editing.set('new');
  }

  startEdit(method: PaymentMethodRow): void {
    this.form.reset({
      code: method.code,
      name: method.name,
      kind: method.kind,
      fiscalCode: method.fiscalCode ?? '',
    });
    // The code is what past documents recorded; the server refuses to change it, so it is not offered.
    this.form.controls.code.disable();
    this.editing.set(method.id);
  }

  cancel(): void {
    this.editing.set(null);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const editing = this.editing();
    const input = {
      name: value.name.trim(),
      kind: value.kind,
      fiscalCode: value.fiscalCode.trim() || null,
    };
    this.busy.set(true);
    const request =
      editing === 'new'
        ? this.api.create({ ...input, code: value.code.trim().toUpperCase() })
        : this.api.update(editing ?? '', input);
    request.subscribe({
      next: () => {
        this.busy.set(false);
        this.editing.set(null);
        this.notifications.showSuccess(
          editing === 'new' ? 'masters.payment_methods.created' : 'masters.payment_methods.updated',
        );
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(err, 'masters.payment_methods.save_failed');
      },
    });
  }

  /** Retire a method from the pickers, or bring it back. Documents that used it keep its code. */
  toggleActive(method: PaymentMethodRow): void {
    this.busy.set(true);
    this.api.update(method.id, { isActive: !method.isActive }).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess(
          method.isActive ? 'masters.payment_methods.retired' : 'masters.payment_methods.reinstated',
          { name: method.name },
        );
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(err, 'masters.payment_methods.save_failed');
      },
    });
  }
}
