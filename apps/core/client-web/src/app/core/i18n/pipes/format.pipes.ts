import { Pipe, PipeTransform, inject } from '@angular/core';
import { FormatService, DatePreset } from '../format.service';
import { LocaleStore } from '../locale.store';
import { VxLocalizedNamePipe } from './localized-name.pipe';

/**
 * The formatting pipes the templates use.
 *
 * ## Why every one of them is impure
 *
 * A pure pipe is memoised on its arguments, so it never re-runs when the *language* changes —
 * only when the value does. Angular's own `DatePipe` gets away with that because `LOCALE_ID` is
 * fixed for the lifetime of the application; here the whole point is that it is not.
 *
 * Impure means `transform` runs on every change-detection pass. Two things keep that cheap:
 *
 *  1. The read of `LocaleStore.locale()` inside `transform` happens in the template's reactive
 *     context, so changing the language marks exactly the views that render a formatted value —
 *     nothing else in the application is disturbed.
 *  2. Each pipe instance memoises its own last answer. A ledger row that has not changed returns
 *     a cached string after one map lookup and one signal read, with no `Intl` work at all.
 *
 * `FormatService` memoises the `Intl` formatters themselves on top of that, so a ten-thousand-row
 * grid constructs one formatter, not ten thousand.
 */
abstract class LocaleAwarePipe {
  protected readonly format = inject(FormatService);
  protected readonly store = inject(LocaleStore);

  private lastKey: string | null = null;
  private lastResult = '';

  /** Memoise on the arguments AND on the locale, so a language change invalidates the answer. */
  protected memo(key: string, compute: () => string): string {
    // Read inside the reactive context: this is the subscription that makes the view re-render.
    const localeKey = `${this.store.locale()}|${this.store.timezone()}`;
    const full = `${localeKey}|${key}`;
    if (full === this.lastKey) return this.lastResult;
    this.lastKey = full;
    this.lastResult = compute();
    return this.lastResult;
  }
}

/**
 * A plain number.
 *
 * Accepts the same `'1.2-2'` digit grammar as Angular's `DecimalPipe`, so migrating a template
 * from `| number: '1.2-2'` to `| vxNumber: '1.2-2'` is a rename and nothing else.
 */
@Pipe({ name: 'vxNumber', standalone: true, pure: false })
export class VxNumberPipe extends LocaleAwarePipe implements PipeTransform {
  transform(value: number | string | null | undefined, digits?: string): string {
    return this.memo(`n|${value}|${digits ?? ''}`, () => this.format.number(value, digits));
  }
}

/**
 * A monetary amount.
 *
 * The currency code is required in spirit and optional in signature: omitting it falls back to
 * the tenant's functional currency, which is correct for a balance in the tenant's own books and
 * wrong for anything a customer sees. Pass the record's own code whenever it has one.
 */
@Pipe({ name: 'vxMoney', standalone: true, pure: false })
export class VxMoneyPipe extends LocaleAwarePipe implements PipeTransform {
  transform(
    value: number | string | null | undefined,
    currencyCode?: string | null,
    display: 'symbol' | 'code' | 'name' = 'symbol',
  ): string {
    return this.memo(`m|${value}|${currencyCode ?? ''}|${display}`, () =>
      this.format.money(value, currencyCode, { display }),
    );
  }
}

/** A ratio (0.075) rendered as a percentage (7,5 %). Not the other way round. */
@Pipe({ name: 'vxPercent', standalone: true, pure: false })
export class VxPercentPipe extends LocaleAwarePipe implements PipeTransform {
  transform(value: number | string | null | undefined, digits?: string): string {
    return this.memo(`p|${value}|${digits ?? ''}`, () => this.format.percent(value, digits));
  }
}

/** 1,2 M - for dashboard tiles where the exact figure is not the point. */
@Pipe({ name: 'vxCompact', standalone: true, pure: false })
export class VxCompactPipe extends LocaleAwarePipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    return this.memo(`c|${value}`, () => this.format.compact(value));
  }
}

/**
 * A date or timestamp, in the TENANT's timezone.
 *
 * `dateOnly` is not a style, it is a statement about the data: a column typed `date` in the
 * database has no time and no zone, and converting it into one is what renders a 1 January
 * invoice as 31 December for a reader far enough west. Pass it for accounting dates - issue date,
 * due date, period end - and leave it off for real instants like "last seen".
 */
@Pipe({ name: 'vxDate', standalone: true, pure: false })
export class VxDatePipe extends LocaleAwarePipe implements PipeTransform {
  transform(
    value: Date | string | number | null | undefined,
    preset: DatePreset = 'date',
    dateOnly = false,
  ): string {
    const key = `d|${value instanceof Date ? value.getTime() : value}|${preset}|${dateOnly}`;
    return this.memo(key, () => this.format.date(value, preset, { dateOnly }));
  }
}

/**
 * "hace 5 minutos" / "5 minutes ago" / "ha 5 minutos".
 *
 * Deliberately NOT memoised on the clock: the answer goes stale by definition, and an impure pipe
 * re-evaluates on the next change detection anyway.
 */
@Pipe({ name: 'vxRelativeTime', standalone: true, pure: false })
export class VxRelativeTimePipe implements PipeTransform {
  private readonly format = inject(FormatService);
  private readonly store = inject(LocaleStore);

  transform(value: Date | string | number | null | undefined): string {
    this.store.locale();
    return this.format.relativeTime(value);
  }
}

/** "a, b y c" - the conjunction and the serial comma are CLDR's business, not the template's. */
@Pipe({ name: 'vxList', standalone: true, pure: false })
export class VxListPipe extends LocaleAwarePipe implements PipeTransform {
  transform(
    items: readonly string[] | null | undefined,
    type: 'conjunction' | 'disjunction' = 'conjunction',
  ): string {
    const list = items ?? [];
    return this.memo(`l|${list.join(' ')}|${type}`, () => this.format.list(list, type));
  }
}

/**
 * Everything a template needs in order to format, as one import.
 *
 * Grouped so a component adds `FORMAT_PIPES` rather than remembering which seven symbols it
 * needs, which is how a template ends up reaching for `| number` again.
 */
export const FORMAT_PIPES = [
  VxNumberPipe,
  VxMoneyPipe,
  VxPercentPipe,
  VxCompactPipe,
  VxDatePipe,
  VxRelativeTimePipe,
  VxListPipe,
  VxLocalizedNamePipe,
] as const;
