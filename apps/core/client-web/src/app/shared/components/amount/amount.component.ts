import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormatService, LocaleStore } from '@virteex/shared/ui-i18n';

/**
 * A monetary figure.
 *
 * ## What this replaces
 *
 * Two incompatible renderings, both in production. 81 figures went through `| vxMoney`, which
 * knows the currency; 126 went through `| vxNumber: '1.2-2'`, which is a bare number — four of
 * them pasted the currency code on by hand (`features/invoices/new/new.page.html:219`,
 * `features/reports/aging/aging.page.html:42`) and the rest, including all 51 figures across the
 * four financial statements, showed no currency at all.
 *
 * Worse, only 7 of those 126 coloured a negative, through five rival `.negative` rules
 * (`kpi-card.scss:106`, `chart-of-accounts.page.scss:69`, `variance-analysis.page.scss:20`,
 * `treasury.page.scss:70`, `stat-summary.scss:89`). In an accounting product, 119 figures where a
 * credit balance and a debit balance look identical is not a styling inconsistency.
 *
 * ## What it does, and what it deliberately does not
 *
 * It formats and presents: currency, tabular figures so columns line up, right alignment, and a
 * visible sign. It computes NOTHING. Every amount in this product comes from the server, which is
 * the only place the document arithmetic exists, and a component that could add would eventually
 * be asked to.
 */
@Component({
  selector: 'vx-amount',
  standalone: true,
  template: `{{ text() }}<span class="vx-amount__unit" aria-hidden="true">{{ suffix() }}</span>`,
  styleUrls: ['./amount.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vx-amount',
    '[class.vx-amount--negative]': 'isNegative()',
    '[class.vx-amount--zero]': 'isZero()',
    '[class.vx-amount--plain]': '!currency()',
  },
})
export class VxAmountComponent {
  //  El servicio y no los pipes: un pipe se construye con `inject()` y hacerlo a mano fuera de un
  //  contexto de inyección falla. Además, leer `locale()` dentro del `computed` es lo que hace que
  //  cambiar de idioma vuelva a pintar la cifra.
  private readonly formatter = inject(FormatService);
  private readonly locale = inject(LocaleStore);

  readonly value = input<number | string | null | undefined>(null);

  /**
   * The record's OWN currency code, whenever it has one.
   *
   * Omitting it falls back to the tenant's functional currency, which is right for a balance in
   * the tenant's own books and wrong for anything a customer sees. A column of figures with no
   * currency anywhere on the screen — which is what the financial statements showed — is a report
   * that cannot be read without asking someone.
   */
  readonly currency = input<string | null>(null);

  /** `symbol` (RD$ 1.200,00), `code` (DOP 1.200,00) or `name`. */
  readonly display = input<'symbol' | 'code' | 'name'>('symbol');

  /** Show a `+` on a positive figure. For variances and movements, where direction is the point. */
  readonly signed = input(false);

  /**
   * Colour the negative.
   *
   * On by default, because in this product a negative figure almost always means something —
   * an overdrawn account, a credit balance, an unfavourable variance. Turn it off where it does
   * not: a withholding line is negative by construction and colouring it red says nothing.
   */
  readonly colourNegative = input(true);

  /** Render as a plain number with this digit grammar instead of as money. */
  readonly digits = input<string | null>(null);

  /** A unit that is not a currency: `%`, `kg`, `h`. Decorative — the figure carries the meaning. */
  readonly suffix = input('');

  private readonly amount = computed(() => {
    const raw = this.value();
    const parsed = typeof raw === 'string' ? Number(raw) : raw;
    return Number.isFinite(parsed) ? (parsed as number) : null;
  });

  protected readonly isNegative = computed(
    () => this.colourNegative() && (this.amount() ?? 0) < 0,
  );
  protected readonly isZero = computed(() => this.amount() === 0);

  protected readonly text = computed(() => {
    const amount = this.amount();
    //  Un importe ausente NO es cero. Un saldo que todavía no ha llegado del servidor y un saldo
    //  de cero son dos hechos distintos, y pintarlos igual hace que el segundo pase por el
    //  primero mientras la pantalla carga.
    if (amount === null) return '—';

    //  Suscripción deliberada: sin esta lectura, la cifra se quedaría en el formato del idioma
    //  con el que se pintó por primera vez.
    this.locale.locale();

    const currency = this.currency();
    const formatted = currency
      ? this.formatter.money(amount, currency, { display: this.display() })
      : this.formatter.number(amount, this.digits() ?? '1.2-2');

    return this.signed() && amount > 0 ? `+${formatted}` : formatted;
  });
}
