import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@virtex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';
import { DraftShellComponent, DraftProblem } from '../../../shared/components/gestures';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { FixedAsset, FixedAssetsService } from '../data/fixed-assets.service';
import { CapitalizationFieldsComponent, capitalizationGroup, capitalizationOf } from './capitalization-fields.component';

/**
 * How an asset's cost entered the ledger, recorded or corrected after it was registered (audit
 * 2026-11-07, FINB-15): an asset registered before the rule, or one linked to the wrong purchase.
 * It changes nothing the asset is valued on; an acquisition posted here before is reversed first.
 */
@Component({
  selector: 'app-fixed-asset-capitalization-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...VX_FORM_A11Y, DraftShellComponent, CapitalizationFieldsComponent],
  template: `
    <vx-draft-shell
      [title]="asset() ? asset()!.number + ' · ' + asset()!.name : ('page_titles.fixed_asset_capitalization' | translate)"
      [subtitle]="'fixed_assets.capitalization.page_subtitle' | translate"
      [dirty]="form.dirty"
      [saving]="saving()"
      [invalid]="form.invalid"
      [problems]="problems()"
      [form]="form"
      (save)="save()"
      (cancelled)="back()"
    >
      <div class="form-body" [formGroup]="form">
        @if (asset(); as doc) {
          <p class="form-hint" role="status">
            {{ 'fixed_assets.capitalization.current' | translate: { method: ('fixed_assets.capitalization.methods.' + doc.capitalizationMethod | translate) } }}
          </p>
          @if (doc.capitalizationMethod === 'POSTED') {
            <p class="form-hint">{{ 'fixed_assets.capitalization.replaces_posted' | translate }}</p>
          }
          <section class="form-section">
            <h2 class="form-section-title">{{ 'fixed_assets.capitalization.title' | translate }}</h2>
            <app-capitalization-fields [group]="form.controls.capitalization" [assetAccountId]="doc.assetAccountId" idPrefix="fac-relink" />
          </section>
        }
      </div>
    </vx-draft-shell>
  `,
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixedAssetCapitalizationPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly assets = inject(FixedAssetsService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  readonly id = input.required<string>();

  readonly form = this.fb.group({ capitalization: capitalizationGroup(this.fb) });
  readonly asset = signal<FixedAsset | null>(null);
  readonly saving = signal(false);
  readonly problems = signal<DraftProblem[]>([]);

  ngOnInit(): void {
    this.assets.get(this.id()).subscribe({
      next: (asset) => {
        this.asset.set(asset);
        this.tab?.setTitle(asset.number);
        // The form opens on what the asset says now.
        if (asset.capitalizationMethod === 'POSTED') {
          this.form.controls.capitalization.reset({ mode: 'POSTED', offsetAccountId: asset.capitalizationOffsetAccountId, date: '', source: null });
        } else if (asset.capitalizationMethod === 'VENDOR_BILL' && asset.vendorBillId) {
          this.form.controls.capitalization.reset({ mode: 'SOURCE', offsetAccountId: null, date: '', source: `VENDOR_BILL|${asset.vendorBillId}|${asset.assetAccountId ?? ''}` });
        } else if (asset.capitalizationMethod === 'JOURNAL_ENTRY' && asset.capitalizationEntryId) {
          this.form.controls.capitalization.reset({
            mode: 'SOURCE',
            offsetAccountId: null,
            date: '',
            source: `JOURNAL_ENTRY|${asset.capitalizationEntryId}|${asset.assetAccountId ?? ''}`,
          });
        }
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'fixed_assets.form.load_failed'),
    });
  }

  save(): void {
    const capitalization = capitalizationOf(this.form.controls.capitalization.getRawValue());
    if ('problem' in capitalization) {
      this.problems.set([{ message: capitalization.problem }]);
      return;
    }
    this.problems.set([]);
    this.saving.set(true);
    this.assets.capitalize(this.id(), capitalization.input).subscribe({
      next: (asset) => {
        this.saving.set(false);
        this.form.markAsPristine();
        this.tab?.markClean();
        this.notifications.showSuccess('fixed_assets.capitalization.saved', { number: asset.number });
        this.back();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'fixed_assets.capitalization.save_failed');
      },
    });
  }

  back(): void {
    void this.router.navigateByUrl(this.organization.urlFor(`/accounting/fixed-assets/${this.id()}`));
  }
}
