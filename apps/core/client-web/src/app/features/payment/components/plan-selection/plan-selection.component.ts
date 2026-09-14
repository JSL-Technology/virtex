import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LocaleStore, translateOrLiteral } from '@virteex/shared/ui-i18n';
import { BillingService } from '../../../../core/services/billing';
import { NotificationService } from '../../../../core/services/notification';
import { formatPlanPrice } from '../../../../core/models/plan.model';

/**
 * Choosing a plan, before signing in.
 *
 * ## What this screen was
 *
 * Every string was a Spanish literal in the template, and the three prices were written into the
 * markup as `$29`, `$79` and `$199`. A bare `$` is ambiguous across this product's markets — it is
 * the dollar, the Dominican peso and the Mexican peso — and the figures were not connected to what
 * Stripe would charge: they came from nowhere, and `/month` was hard-coded beside them.
 *
 * The data it loaded was worse than unused. It called `GET /payment/config`, which was removed for
 * publishing raw Stripe price identifiers to any authenticated caller, so the request 404'd on every
 * visit and the screen showed its invented prices regardless.
 *
 * ## What it is now
 *
 * The same plan catalogue the registration wizard reads — `GET /saas/plans`, through
 * `BillingService` — with every amount formatted by `formatPlanPrice`, which takes the currency and
 * the minor-unit factor the server publishes for the visitor's country. A Chilean peso price is not
 * divided by a hundred, and the currency is named rather than implied by a symbol.
 */
@Component({
  selector: 'app-plan-selection',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="plans">
      <header class="plans__head">
        <h1>{{ 'payment.plans.title' | translate }}</h1>
        <p>{{ 'payment.plans.subtitle' | translate }}</p>
      </header>

      @switch (billing.plansState()) {
        @case ('loading') {
          <p class="plans__note">{{ 'payment.plans.loading' | translate }}</p>
        }
        @case ('error') {
          <p class="plans__note plans__note--error">{{ 'payment.plans.load_error' | translate }}</p>
        }
        @default {
          <div class="plans__grid">
            @for (plan of cards(); track plan.slug) {
              <article class="plan" [class.plan--featured]="plan.featured">
                @if (plan.featured) {
                  <span class="plan__badge">{{ 'payment.plans.popular' | translate }}</span>
                }
                <h2 class="plan__name">{{ plan.name }}</h2>
                <p class="plan__price">
                  <span class="plan__amount">{{ plan.price }}</span>
                  <span class="plan__period">{{ 'payment.plans.per_month' | translate }}</span>
                </p>
                <p class="plan__description">{{ plan.description }}</p>
                <button
                  type="button"
                  class="plan__cta"
                  [disabled]="isLoading()"
                  (click)="selectPlan(plan.slug)"
                >
                  {{
                    isLoading()
                      ? ('payment.plans.processing' | translate)
                      : ('payment.plans.choose' | translate: { plan: plan.name })
                  }}
                </button>
              </article>
            } @empty {
              <p class="plans__note">{{ 'payment.plans.none_available' | translate }}</p>
            }
          </div>
          <p class="plans__footnote">
            {{ 'payment.plans.tax_note' | translate: { currency: currency() } }}
          </p>
        }
      }
    </section>
  `,
  styleUrl: './plan-selection.component.scss',
})
export class PlanSelectionComponent {
  readonly billing = inject(BillingService);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LocaleStore);

  readonly isLoading = signal(false);

  /** The currency the catalogue came back in, so the footnote names it instead of assuming USD. */
  readonly currency = computed(() => this.billing.plans()[0]?.currency ?? '');

  readonly cards = computed(() =>
    this.billing.plans().map((plan, index, all) => ({
      slug: plan.slug,
      // A plan's name and description are the customer-facing catalogue's own text, which may be a
      // key this product wrote or a string an operator typed. `translateOrLiteral` renders either
      // without ever showing a reader a dotted identifier.
      name: translateOrLiteral(this.translate, plan.name),
      description: translateOrLiteral(this.translate, plan.description),
      price: formatPlanPrice(plan, this.locale.locale()),
      featured: all.length > 2 && index === 1,
    })),
  );

  selectPlan(slug: string): void {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    this.billing.startCheckout(slug).subscribe({
      next: (started) => {
        // `startCheckout` navigates away on success. Reaching here with `false` means the plan has
        // no price the checkout can charge, which is a configuration problem, not the reader's.
        if (!started) {
          this.isLoading.set(false);
          this.notifications.showError('payment.plans.checkout_error');
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.notifications.showError('payment.plans.checkout_error');
      },
    });
  }
}
