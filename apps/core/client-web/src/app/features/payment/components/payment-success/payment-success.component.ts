import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Where Stripe sends the reader after a successful checkout.
 *
 * Its two sentences were Spanish literals in this template, which the scanner never saw because it
 * only read `.html` files. An English-speaking customer who had just paid was congratulated in
 * Spanish — on a page reached from an external redirect, so it is also the first thing they see
 * coming back into the product.
 */
@Component({
  selector: 'app-payment-success',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="outcome">
      <div class="outcome__card">
        <span class="outcome__mark outcome__mark--ok" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <h1>{{ 'payment.success.title' | translate }}</h1>
        <p>{{ 'payment.success.body' | translate }}</p>
        <a class="outcome__cta" routerLink="/overview">
          {{ 'payment.success.go_to_dashboard' | translate }}
        </a>
      </div>
    </section>
  `,
  styleUrl: './payment-outcome.component.scss',
})
export class PaymentSuccessComponent {}
