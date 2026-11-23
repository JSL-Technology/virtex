import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Observable, map, of, startWith, switchMap } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, FormatService, LocaleStore } from '@virtex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';
import { VX_SELECT } from '../../../shared/components/select';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { Account } from '../../../core/models/account.model';
import { CapitalizationInput, CapitalizationSource, FixedAssetsService } from '../data/fixed-assets.service';

/** How a form says the cost entered the ledger: posted here, or from a purchase already in the books. */
export type CapitalizationMode = 'POSTED' | 'SOURCE';

/** The controls a form holds the choice in; `capitalizationGroup` builds them. */
export interface CapitalizationControls {
  mode: CapitalizationMode;
  offsetAccountId: string | null;
  /** Empty: the acquisition date. */
  date: string;
  /** `<kind>|<id>|<accountId>` of the source chosen. */
  source: string | null;
}

/** The group the choice lives in, ready to nest in a form. */
export function capitalizationGroup(fb: FormBuilder, initial: Partial<CapitalizationControls> = {}) {
  return fb.group({
    mode: [initial.mode ?? ('POSTED' as CapitalizationMode)],
    offsetAccountId: [initial.offsetAccountId ?? (null as string | null)],
    date: [initial.date ?? ''],
    source: [initial.source ?? (null as string | null)],
  });
}

/** The key a source is chosen by. */
export function sourceKey(source: Pick<CapitalizationSource, 'kind' | 'id' | 'accountId'>): string {
  return `${source.kind}|${source.id}|${source.accountId}`;
}

/**
 * The capitalization the choice describes, or the problem with it: a posting needs the account it
 * is credited to, a link the purchase it comes from.
 */
export function capitalizationOf(value: Partial<CapitalizationControls>): { input: CapitalizationInput } | { problem: string } {
  if (value.mode === 'SOURCE') {
    const [kind, id] = (value.source ?? '').split('|');
    if (!kind || !id) return { problem: 'fixed_assets.capitalization.source_required' };
    return { input: kind === 'VENDOR_BILL' ? { method: 'VENDOR_BILL', vendorBillId: id } : { method: 'JOURNAL_ENTRY', journalEntryId: id } };
  }
  if (!value.offsetAccountId) return { problem: 'fixed_assets.capitalization_offset_required' };
  return { input: { method: 'POSTED', offsetAccountId: value.offsetAccountId, ...(value.date ? { date: value.date } : {}) } };
}

/**
 * How an asset's cost entered the ledger (audit 2026-11-07, FINB-15), chosen where it is registered
 * or linked later: the acquisition posted here against the account named — the bank, a payable,
 * opening equity — or a purchase already in the books, from the list of what bills and entries
 * debited a fixed-asset account and nobody registered yet.
 */
@Component({
  selector: 'app-capitalization-fields',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, VxDateFieldComponent],
  template: `
    <div class="form-grid" [formGroup]="group()">
      <fieldset class="field field--wide">
        <legend>{{ 'fixed_assets.capitalization.how' | translate }}</legend>
        <label class="doc-check">
          <input type="radio" formControlName="mode" value="POSTED" />
          {{ 'fixed_assets.capitalization.mode_posted' | translate }}
        </label>
        <label class="doc-check">
          <input type="radio" formControlName="mode" value="SOURCE" />
          {{ 'fixed_assets.capitalization.mode_source' | translate }}
        </label>
      </fieldset>
      @if (mode() === 'POSTED') {
        <label class="field field--wide" [for]="idPrefix() + '-offset'">
          <span>{{ 'fixed_assets.capitalization.offset' | translate }}</span>
          <vx-select [inputId]="idPrefix() + '-offset'" formControlName="offsetAccountId" [search]="searchOffsetAccounts"
                     [resolveWith]="resolveAccount" [displayWith]="accountLabel" [valueWith]="accountId"
                     placeholderKey="fixed_assets.form.select_account" />
          <small class="form-hint">{{ 'fixed_assets.capitalization.offset_hint' | translate }}</small>
        </label>
        <label class="field" [for]="idPrefix() + '-date'">
          <span>{{ 'fixed_assets.capitalization.date' | translate }}</span>
          <vx-date-field [inputId]="idPrefix() + '-date'" formControlName="date" />
          <small class="form-hint">{{ 'fixed_assets.capitalization.date_hint' | translate }}</small>
        </label>
      } @else {
        <label class="field field--wide" [for]="idPrefix() + '-source'">
          <span>{{ 'fixed_assets.capitalization.source' | translate }}</span>
          <vx-select [inputId]="idPrefix() + '-source'" formControlName="source" [search]="searchSources"
                     [resolveWith]="resolveSource" [displayWith]="sourceLabel" [valueWith]="sourceValue"
                     placeholderKey="fixed_assets.capitalization.source_placeholder" emptyLabelKey="fixed_assets.capitalization.no_sources" />
          <small class="form-hint">{{ 'fixed_assets.capitalization.source_hint' | translate }}</small>
        </label>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapitalizationFieldsComponent {
  private readonly assets = inject(FixedAssetsService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly locale = inject(LocaleStore);
  private readonly format = inject(FormatService);

  /** The group `capitalizationGroup` built. */
  readonly group = input.required<FormGroup>();
  /** The asset's account: the purchases offered are the ones that debited it. */
  readonly assetAccountId = input<string | null>(null);
  readonly idPrefix = input('fa-cap');

  /** The mode chosen, as the group's control says it now and as it changes. */
  protected readonly mode = toSignal(
    toObservable(this.group).pipe(
      switchMap((group) => {
        const control = group.get('mode');
        return control ? toObservableMode(control.valueChanges, control.value) : of('POSTED' as CapitalizationMode);
      }),
    ),
    { initialValue: 'POSTED' as CapitalizationMode },
  );

  /** Where an acquisition is credited: money, a payable, equity — not another fixed-asset account. */
  protected readonly searchOffsetAccounts = (query: string, limit: number): Observable<Account[]> =>
    this.accounts
      .searchAccounts(query, limit)
      .pipe(map((list) => (list ?? []).filter((account) => account.isPostable && account.isActive !== false && account.category !== 'NON_CURRENT_ASSET')));
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${this.locale.nameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  protected readonly searchSources = (query: string, limit: number): Observable<CapitalizationSource[]> =>
    this.assets.capitalizationSources({ search: query || null, accountId: this.assetAccountId(), pageSize: limit }).pipe(map((page) => page.rows));
  protected readonly resolveSource = (key: string): Observable<CapitalizationSource> => {
    const [kind, id, accountId] = key.split('|');
    return this.assets
      .capitalizationSources({ ...(kind === 'VENDOR_BILL' ? { vendorBillId: id } : { journalEntryId: id }), accountId, pageSize: 5 })
      .pipe(map((page) => page.rows[0] ?? placeholderSource(kind, id, accountId)));
  };
  protected readonly sourceLabel = (source: CapitalizationSource): string =>
    [
      source.date ? this.format.date(source.date, 'date', { dateOnly: true }) : '',
      source.supplier ?? source.entryNumber,
      source.reference,
      source.accountCode ? `${source.accountCode} · ${this.format.number(source.available, '1.2-2')}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  protected readonly sourceValue = (source: CapitalizationSource): string => sourceKey(source);
}

function toObservableMode(changes: Observable<unknown>, current: unknown): Observable<CapitalizationMode> {
  return changes.pipe(startWith(current), map((value) => (value === 'SOURCE' ? 'SOURCE' : 'POSTED')));
}

/** A source no longer waiting — registered in full since — still reads as what it was. */
function placeholderSource(kind: string, id: string, accountId: string): CapitalizationSource {
  return {
    kind: kind === 'VENDOR_BILL' ? 'VENDOR_BILL' : 'JOURNAL_ENTRY',
    id,
    journalEntryId: id,
    entryNumber: null,
    date: '',
    reference: id.slice(0, 8),
    supplier: null,
    accountId,
    accountCode: '',
    accountName: {},
    debited: 0,
    registered: 0,
    available: 0,
  };
}
