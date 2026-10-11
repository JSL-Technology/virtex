import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CardBrand, cardBrandLabel, normalizeCardBrand } from './card-brand.util';

/**
 * The acceptance mark of a payment network — Visa, Mastercard, Amex, … — as inline SVG.
 *
 * ## Why a component and not an `<img>` per brand
 *
 * The same reasoning as {@link BrandLogo}: an `<img src="visa.svg">` means one asset file per
 * brand, a glob to ship them, and a 404 the day a path is wrong. Inline SVG is self-contained,
 * scales to whatever `size` the caller asks for without a second file, and — crucially here —
 * lets a brand we have no artwork for fall through to a drawn generic card instead of a broken
 * image. There is no network round-trip and nothing to keep in sync.
 *
 * ## Why every logo sits on a white plate
 *
 * Card-network marks are defined on white: Visa's blue, Mastercard's red/orange circles and
 * Diners' blue emblem are illegible on a dark surface and invisible on a light one that happens to
 * match. Rather than ship a themed variant of each — four files per brand — the component gives
 * every mark the same small white tile it has on a physical card. That one rule makes the logo
 * read identically on a light table row, a dark card face or either app theme, which is the whole
 * point of having it in one place.
 *
 * ## Why the brand is a closed enum
 *
 * See {@link normalizeCardBrand}. The provider's string is folded to one of a fixed set; an
 * unrecognised network is `unknown` and draws the generic glyph. A new brand is a one-line
 * addition here, not a defect that reaches the user as an empty box.
 */
@Component({
  selector: 'vx-card-brand',
  standalone: true,
  templateUrl: './card-brand.component.html',
  styleUrls: ['./card-brand.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vx-card-brand',
    '[class]': "'vx-card-brand vx-card-brand--' + normalized()",
    '[style.width.px]': 'size()',
    // Decorative inside a larger labelled control (the card face announces itself as a whole);
    // an image with its own name when it stands alone in a table or a list.
    '[attr.role]': 'decorative() ? null : "img"',
    '[attr.aria-label]': 'decorative() ? null : label()',
    '[attr.aria-hidden]': 'decorative() ? "true" : null',
  },
})
export class VxCardBrandComponent {
  /** The provider's brand string, in any spelling. Folded to a {@link CardBrand} before drawing. */
  readonly brand = input<string | null | undefined>(null);

  /** Logo width in px; the white plate keeps the network's own aspect around it. */
  readonly size = input<number>(40);

  /**
   * Suppress the screen-reader name when the mark lives inside something already labelled — a
   * payment-card face, a radio option whose text names the brand — so the logo is not announced
   * twice.
   */
  readonly decorative = input<boolean>(false);

  protected readonly normalized = computed<CardBrand>(() => normalizeCardBrand(this.brand()));
  protected readonly label = computed(() => cardBrandLabel(this.normalized()));
}
