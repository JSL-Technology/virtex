import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { Observable, map, startWith } from 'rxjs';
import { TranslateModule, FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { VxDateFieldComponent } from '../../../shared/components/date';
import { VX_SELECT } from '../../../shared/components/select';
import { VxAmountComponent } from '../../../shared/components/amount';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { disposalProceedsAccounts, disposalResultAccounts } from '../../../core/services/account-selection';
import { Account } from '../../../core/models/account.model';
import { FixedAsset, FixedAssetSchedule, FixedAssetsService } from '../data/fixed-assets.service';

const round2 = (value: number): number => Math.round(value * 100) / 100;
const todayIso = (): string => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/**
 * What an asset will be carried at on the day it leaves: its book value after every month before
 * the disposal month is charged, which the disposal does first.
 */
export function carryingOnDisposal(asset: FixedAsset, schedule: FixedAssetSchedule | null, disposalDate: string): number {
  const monthStart = `${disposalDate.slice(0, 7)}-01`;
  const charged = (schedule?.projected ?? []).filter((row) => row.periodEnd < monthStart);
  return charged.length ? charged[charged.length - 1].bookValueAfter : round2(asset.cost - asset.accumulatedDepreciation);
}

/**
 * Retiring an asset (audit H-21): sold, scrapped, stolen. Before posting it says what the entry
 * will be — the months still to charge, the carrying amount on the day, and the gain or the loss —
 * so the accounts it asks for are only the ones that entry needs.
 */
@Component({
  selector: 'app-fixed-asset-dispose-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, ...VX_SELECT, DraftShellComponent, VxDateFieldComponent, VxAmountComponent],
  templateUrl: './fixed-asset-dispose.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedAssetDisposePage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly assets = inject(FixedAssetsService);
  private readonly accounts = inject(ChartOfAccountsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input.required<string>();

  readonly form = this.fb.group({
    disposalDate: [todayIso(), [Validators.required]],
    salePrice: [0 as number | null, [Validators.required, Validators.min(0)]],
    disposalReason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
    cashAccountId: [null as string | null],
    gainOnDisposalAccountId: [null as string | null],
    lossOnDisposalAccountId: [null as string | null],
  });

  readonly asset = signal<FixedAsset | null>(null);
  readonly schedule = signal<FixedAssetSchedule | null>(null);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);

  private readonly values = toSignal(this.form.valueChanges.pipe(startWith(this.form.value)), { initialValue: this.form.value });

  /** The entry the disposal will post, worked out from the schedule. */
  readonly outcome = computed(() => {
    const asset = this.asset();
    const values = this.values();
    if (!asset || !values.disposalDate) return null;
    const carrying = carryingOnDisposal(asset, this.schedule(), values.disposalDate);
    const price = round2(Number(values.salePrice) || 0);
    const monthStart = `${values.disposalDate.slice(0, 7)}-01`;
    const catchUp = (this.schedule()?.projected ?? []).filter((row) => row.periodEnd < monthStart).length;
    return { carrying, price, result: round2(price - carrying), catchUp };
  });

  protected readonly searchProceeds = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => disposalProceedsAccounts(list ?? [])));
  protected readonly searchGain = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => disposalResultAccounts(list ?? [], 'gain')));
  protected readonly searchLoss = (query: string, limit: number): Observable<Account[]> =>
    this.accounts.searchAccounts(query, limit).pipe(map((list) => disposalResultAccounts(list ?? [], 'loss')));
  protected readonly resolveAccount = (id: string): Observable<Account> => this.accounts.getAccountById(id);
  protected readonly accountLabel = (account: Account): string => `${account.code} — ${accountNameOf(account.name)}`;
  protected readonly accountId = (account: Account): string => account.id;

  ngOnInit(): void {
    this.assets.get(this.id()).subscribe({
      next: (asset) => {
        this.asset.set(asset);
        this.tab?.setTitle(asset.number);
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'fixed_assets.document.load_failed'),
    });
    this.assets.schedule(this.id()).subscribe({
      next: (schedule) => this.schedule.set(schedule),
      error: () => this.schedule.set(null),
    });
  }

  save(): void {
    const outcome = this.outcome();
    if (!this.validate() || !outcome) return;
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.assets
      .dispose(this.id(), {
        disposalDate: raw.disposalDate as string,
        salePrice: outcome.price,
        disposalReason: (raw.disposalReason ?? '').trim(),
        ...(outcome.price > 0 && raw.cashAccountId ? { cashAccountId: raw.cashAccountId } : {}),
        ...(outcome.result > 0 && raw.gainOnDisposalAccountId ? { gainOnDisposalAccountId: raw.gainOnDisposalAccountId } : {}),
        ...(outcome.result < 0 && raw.lossOnDisposalAccountId ? { lossOnDisposalAccountId: raw.lossOnDisposalAccountId } : {}),
      })
      .subscribe({
        next: (asset) => {
          this.saving.set(false);
          this.form.markAsPristine();
          this.tab?.markClean();
          this.notifications.showSuccess('fixed_assets.dispose.done', { number: asset.number });
          const route = `/accounting/fixed-assets/${asset.id}`;
          if (this.tab) this.tab.replaceRoute(route, { title: asset.number });
          else void this.router.navigateByUrl(this.organization.urlFor(route));
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'fixed_assets.dispose.failed');
        },
      });
  }

  cancel(): void {
    void this.router.navigateByUrl(this.organization.urlFor(`/accounting/fixed-assets/${this.id()}`));
  }

  private validate(): boolean {
    const outcome = this.outcome();
    const raw = this.form.getRawValue();
    const asset = this.asset();
    const extra: DraftProblem[] = [];
    if (asset && raw.disposalDate && raw.disposalDate < asset.acquisitionDate) {
      extra.push({ message: 'fixed_assets.dispose.before_acquisition' });
    }
    if (outcome) {
      if (outcome.price > 0 && !raw.cashAccountId) extra.push({ message: 'fixed_assets.proceeds_account_required' });
      if (outcome.result > 0 && !raw.gainOnDisposalAccountId) extra.push({ message: 'fixed_assets.gain_account_required' });
      if (outcome.result < 0 && !raw.lossOnDisposalAccountId) extra.push({ message: 'fixed_assets.loss_account_required' });
    }
    if (this.form.invalid || extra.length) {
      this.form.markAllAsTouched();
      this.problems.set([
        ...draftProblems(this.form, {
          disposalDate: 'fixed_assets.dispose.date',
          salePrice: 'fixed_assets.dispose.price',
          disposalReason: 'fixed_assets.dispose.reason',
        }),
        ...extra,
      ]);
      return false;
    }
    this.problems.set([]);
    return true;
  }
}
