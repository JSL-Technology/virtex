import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { TranslateModule, LocaleStore } from '@virteex/shared/ui-i18n';
import { RegionalFormat, normaliseRegionalFormat } from '@virteex/shared/types';
import { RegionalFormatService } from '../../../core/services/regional-format.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { SettingsActionsDirective, SettingsChanges, SettingsSaveBarComponent, SettingsShellService } from '../shell';
import { RegionalFormatEditorComponent } from './regional-format-editor.component';

const same = (a: RegionalFormat, b: RegionalFormat): boolean =>
  JSON.stringify(normaliseRegionalFormat(a)) === JSON.stringify(normaliseRegionalFormat(b));

/**
 * How dates, numbers and times are written, at one of two levels (`view`).
 *
 * - **`company`** — the default for every member, chosen by whoever may edit the company. Saved
 *   explicitly, after saying it changes what everyone sees, because a decimal comma that appears
 *   overnight in every report is a surprise worth one confirmation.
 * - **`personal`** — this person's own choice over the company's, field by field. Saved as it is
 *   chosen, like the rest of the preferences, and applied to the screen at once.
 *
 * Before this, neither existed: formats came from the language and the company's country only.
 */
import { SettingsGroupComponent } from '../shared';
import { VxErrorStateComponent, VxSpinnerComponent } from '../../../shared/components/feedback';

@Component({
  selector: 'app-regional-format-page',
  standalone: true,
  imports: [TranslateModule, RegionalFormatEditorComponent, SettingsSaveBarComponent, SettingsActionsDirective, SettingsGroupComponent, VxSpinnerComponent, VxErrorStateComponent],
  template: `
    @if (view() === 'company') {
      @if (canEdit() && saved() && !isEmpty(saved()!)) {
        <ng-template appSettingsActions>
          <button type="button" class="secondary-button" (click)="resetCompany()">{{ 'settings.regional_format.reset_company' | translate }}</button>
        </ng-template>
      }
      @if (loadFailed()) {
        <vx-error-state [detail]="'settings.regional_format.load_failed' | translate" (retry)="load()" />
      } @else if (saved()) {
        <vx-settings-group titleKey="settings.regional_format.formats_title" descriptionKey="settings.regional_format.company_note">
          <app-regional-format-editor [value]="draft()" [inherited]="{}" [disabled]="!canEdit() || saving()" (valueChange)="draft.set($event)" />
        </vx-settings-group>
      } @else {
        <vx-spinner />
      }
      @if (canEdit()) {
        <vx-settings-save-bar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()" />
      }
    } @else {
      <vx-settings-group titleKey="settings.regional_format.personal_title" descriptionKey="settings.regional_format.personal_note">
        @if (!isEmpty(personal())) {
          <button groupActions type="button" class="ghost-button" (click)="followCompany()">{{ 'settings.regional_format.follow_company' | translate }}</button>
        }
        <app-regional-format-editor [value]="personal()" [inherited]="company()" [disabled]="saving()" (valueChange)="savePersonal($event)" />
      </vx-settings-group>
    }
  `,
  styleUrl: './regional-format.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegionalFormatPage implements OnInit {
  private readonly service = inject(RegionalFormatService);
  private readonly store = inject(LocaleStore);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly shell = inject(SettingsShellService, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  /** `company`: the default for everyone. `personal`: this person's own, over the company's. */
  readonly view = input<'company' | 'personal'>('company');

  protected readonly canEdit = computed(() => this.shell?.canEdit() ?? true);
  protected readonly saving = signal(false);
  protected readonly loadFailed = signal(false);

  // ── Company ─────────────────────────────────────────────────────────────
  /** What the server holds; null until read. */
  protected readonly saved = signal<RegionalFormat | null>(null);
  protected readonly draft = signal<RegionalFormat>({});
  protected readonly dirty = computed(() => this.saved() !== null && !same(this.draft(), this.saved()!));

  private readonly changes: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.saveCompany(),
    discard: () => this.discard(),
  };

  // ── Personal ────────────────────────────────────────────────────────────
  protected readonly personal = this.store.personalFormat;
  protected readonly company = this.store.companyFormat;

  ngOnInit(): void {
    if (this.view() === 'personal') {
      this.shell?.autosaves.set(true);
      return;
    }
    this.load();
    if (this.shell) {
      this.shell.register(this.changes);
      this.destroyRef.onDestroy(() => this.shell?.unregister(this.changes));
    }
  }

  load(): void {
    this.loadFailed.set(false);
    this.service.company().subscribe({
      next: (format) => {
        this.saved.set(format);
        this.draft.set(format);
      },
      error: () => this.loadFailed.set(true),
    });
  }

  isEmpty(format: RegionalFormat): boolean {
    return Object.keys(normaliseRegionalFormat(format)).length === 0;
  }

  save(): void {
    void this.saveCompany();
  }

  /** Saves the company's default, after saying it changes what everyone sees. */
  async saveCompany(): Promise<boolean> {
    if (!this.canEdit() || !this.dirty()) return false;
    const confirmed = await this.dialog.confirm({
      title: 'settings.regional_format.confirm_title',
      message: 'settings.regional_format.confirm_message',
      confirmText: 'settings.regional_format.confirm_action',
      variant: 'warning',
    });
    if (!confirmed) return false;
    return this.persistCompany(this.draft());
  }

  discard(): void {
    const saved = this.saved();
    if (saved) this.draft.set(saved);
  }

  async resetCompany(): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'settings.regional_format.reset_title',
      message: 'settings.regional_format.reset_message',
      confirmText: 'settings.regional_format.reset_company',
      variant: 'warning',
    });
    if (confirmed) await this.persistCompany({});
  }

  private persistCompany(format: RegionalFormat): Promise<boolean> {
    this.saving.set(true);
    return new Promise((resolve) =>
      this.service.saveCompany(format).subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.saved.set(saved);
          this.draft.set(saved);
          this.notifications.showSuccess('settings.regional_format.saved_company');
          resolve(true);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'settings.regional_format.save_failed');
          resolve(false);
        },
      }),
    );
  }

  // ── Personal ────────────────────────────────────────────────────────────

  /** Saved as chosen, like every preference; the screen follows at once. */
  savePersonal(format: RegionalFormat): void {
    this.saving.set(true);
    this.service.savePersonal(format).subscribe({
      next: () => {
        this.saving.set(false);
        this.shell?.markAutosaved();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'settings.regional_format.save_failed');
      },
    });
  }

  followCompany(): void {
    this.savePersonal({});
  }
}
