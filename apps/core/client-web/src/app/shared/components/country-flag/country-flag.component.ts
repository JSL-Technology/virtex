import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';

/**
 * A country's flag, from `assets/flags/<code>.svg`, with the emoji flag as a fallback.
 *
 * The SVGs cover the markets the product sells in (they come from `flag-icons`, MIT — see
 * `assets/flags/LICENSE-flag-icons.txt`). A country opened later without its file still gets a
 * flag: the regional-indicator emoji, which every platform but desktop Windows draws, and which
 * Windows shows as the two letters of the code — still a correct label, never a broken image.
 *
 * Decorative: the country's NAME is always next to it, so the image is `alt=""`.
 */
@Component({
  selector: 'app-country-flag',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!failed() && code()) {
      <img class="flag" [src]="'assets/flags/' + code() + '.svg'" alt="" (error)="failed.set(true)" />
    } @else {
      <span class="flag flag--emoji" aria-hidden="true">{{ emoji() }}</span>
    }
  `,
  styles: [
    `
      :host { display: inline-flex; flex-shrink: 0; }
      .flag {
        width: 1.5em;
        height: 1.125em;
        border-radius: 2px;
        object-fit: cover;
        box-shadow: 0 0 0 1px var(--border-subtle);
      }
      .flag--emoji { box-shadow: none; line-height: 1.125em; font-size: 1.1em; text-align: center; }
    `,
  ],
})
export class CountryFlagComponent {
  readonly code = signal('');
  readonly failed = signal(false);

  /** ISO 3166-1 alpha-2, any case. */
  @Input({ required: true }) set country(value: string | null | undefined) {
    this.code.set((value ?? '').trim().toLowerCase());
    this.failed.set(false);
  }

  readonly emoji = computed(() =>
    /^[a-z]{2}$/.test(this.code())
      ? String.fromCodePoint(...[...this.code().toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
      : '',
  );
}
