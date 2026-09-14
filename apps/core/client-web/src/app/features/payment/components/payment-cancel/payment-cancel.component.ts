import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Where Stripe sends the reader when they back out of the checkout.
 *
 * Its sentences were Spanish literals in this template. It also said nothing about whether anything
 * had been charged, which is the one question somebody who just cancelled a payment has.
 */
@Component({
  selector: 'app-payment-cancel',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="outcome">
      <div class="outcome__card">
        <span class="outcome__mark outcome__mark--warn" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
        <h1>{{ 'payment.cancel.title' | translate }}</h1>
        <p>{{ 'payment.cancel.body' | translate }}</p>
        <a class="outcome__cta" routerLink="/auth/plan-selection">
          {{ 'payment.cancel.back_to_plans' | translate }}
        </a>
      </div>
    </section>
  `,
  styleUrl: './payment-outcome.component.scss',
})
export class PaymentCancelComponent {}
