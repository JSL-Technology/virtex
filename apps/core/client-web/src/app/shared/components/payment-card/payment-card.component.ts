import { TranslatePipe } from '@ngx-translate/core';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CardBrand, cardBrandLabel, normalizeCardBrand, VxCardBrandComponent } from '../card-brand';

/**
 * A card on file, drawn as the card.
 *
 * ## What it is for
 *
 * The billing screen used to show the stored card as one line of text — `Visa •••• 4242`. This is
 * the same fact given the shape people already recognise: a card face, with the network's mark,
 * the masked number and the expiry where they sit on a real card. It is a presentational
 * component — it holds no state and makes no request — so the same visual serves the billing
 * screen, a POS «card on file» and a customer's saved methods without any of them re-inventing it.
 *
 * ## Why the face is a fixed colour and not a theme surface
 *
 * A credit card looks like a credit card in daylight and at night; it does not repaint itself for
 * a dark UI theme. The gradients here are therefore LITERAL and brand-tinted, which is why this
 * folder is on the token guardian's allow-list — the same exemption the invoice *print sheet*
 * carries, and for the same reason: this is a fixed-appearance artefact, not a themed surface. The
 * network mark inside comes from {@link VxCardBrandComponent}, which keeps its own white plate, so
 * it stays legible whatever gradient sits behind it.
 *
 * ## Why only `last4`
 *
 * That is all a payment provider ever returns, and all we would ever want to store. The face shows
 * `•••• •••• •••• 4242` to read as a card; the leading groups are decoration, never real digits.
 */
@Component({
  selector: 'vx-payment-card',
  standalone: true,
  imports: [VxCardBrandComponent, TranslatePipe],
  templateUrl: './payment-card.component.html',
  styleUrls: ['./payment-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vx-payment-card',
    '[class]': "'vx-payment-card vx-payment-card--' + normalized()",
    '[attr.role]': '"img"',
    '[attr.aria-label]': 'ariaLabel()',
  },
})
export class VxPaymentCardComponent {
  /** The provider's brand string, in any spelling. */
  readonly brand = input<string | null | undefined>(null);

  /** The last four digits the provider returns; the only real digits on the face. */
  readonly last4 = input<string | null | undefined>(null);

  /** Expiry month, 1–12. */
  readonly expMonth = input<number | null | undefined>(null);

  /** Expiry year, four digits; shown as the trailing two, as a card prints it. */
  readonly expYear = input<number | null | undefined>(null);

  protected readonly normalized = computed<CardBrand>(() => normalizeCardBrand(this.brand()));

  /** `•••• 4242`, or em dashes in that slot when the provider gave us no digits. */
  protected readonly last4Display = computed(() => this.last4() ?? '••••');

  /** `MM/YY`, the trailing two year digits, or `••/••` when the expiry is unknown. */
  protected readonly expiry = computed(() => {
    const month = this.expMonth();
    const year = this.expYear();
    if (!month || !year) return '••/••';
    const mm = String(month).padStart(2, '0');
    const yy = String(year).slice(-2);
    return `${mm}/${yy}`;
  });

  /**
   * One sentence for a screen reader — brand and last four — because the face is a single `img`
   * and should read as one thing, not as a chip, a logo and three groups of dots. Proper nouns and
   * digits, so it needs no translation.
   */
  protected readonly ariaLabel = computed(
    () => `${cardBrandLabel(this.normalized())} •••• ${this.last4Display()}`,
  );
}
