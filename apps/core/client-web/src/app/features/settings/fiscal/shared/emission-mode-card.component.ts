import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { FiscalEmissionMode, InvoicingContext } from '../../../../core/services/invoices';
import { NotificationService } from '../../../../core/services/notification';
import { OrganizationSettingsService } from '../../data/organization-settings.service';
import { VxBadgeComponent } from '../../../../shared/components/badge';
import { VxNoticeComponent } from '../../../../shared/components/feedback';
import { SettingsGroupComponent } from '../../shared/settings-group.component';
import { SettingsChanges, SettingsSaveBarComponent, SettingsShellService } from '../../shell';

/** A requirement the company still lacks, said with the page it is met on and a way to get there. */
export interface GapItem {
  textKey: string;
  params?: Record<string, unknown>;
  /** A section of the settings window, by its fragment. */
  fragment?: string;
  /** A control on this same page, by its id: the action scrolls to it and focuses it. */
  target?: string;
  actionKey?: string;
}

/** One choice of the emission mode, as the card presents it. */
interface EmissionModeChoice {
  value: FiscalEmissionMode;
  titleKey: string;
  descriptionKey: string;
}

/**
 * How the company issues its fiscal documents, and what it can issue today — in any market.
 *
 * The mode (traditional, electronic or both) is offered only where the market has both kinds of
 * document, which the server says (`InvoicingContext.emissionModeApplies`): the Dominican Republic
 * today, any other market whose catalogue declares traditional types tomorrow. Everywhere, the card
 * says what the invoice form will let the company issue right now and, when nothing, what is
 * missing — the same answer the form and the issue itself use.
 */
@Component({
  selector: 'vx-emission-mode-card',
  standalone: true,
  imports: [TranslateModule, RouterLink, VxBadgeComponent, VxNoticeComponent, SettingsGroupComponent, SettingsSaveBarComponent],
  templateUrl: './emission-mode-card.component.html',
  styleUrls: ['./emission-mode-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmissionModeCardComponent {
  private readonly organizationSettings = inject(OrganizationSettingsService);
  private readonly notifications = inject(NotificationService);
  private readonly shell = inject(SettingsShellService, { optional: true });

  /** What the invoice form will offer, as the server computes it. */
  readonly context = input<InvoicingContext | null>(null);
  /** Shown, not changeable: the reader may see the fiscal set-up without `taxes:edit`. */
  readonly readonly = input(false);
  /** The mode, once read and every time it is changed. */
  readonly modeChange = output<FiscalEmissionMode>();
  /** The mode was saved: whatever depends on it should be read again. */
  readonly changed = output<void>();

  /** The mode in effect, as the server has it. */
  readonly mode = signal<FiscalEmissionMode>('BOTH');
  /** The mode the form shows; sent with the save bar, like every other form of the window. */
  readonly draft = signal<FiscalEmissionMode>('BOTH');
  readonly saving = signal(false);
  readonly dirty = computed(() => this.draft() !== this.mode());

  private readonly changes: SettingsChanges = {
    dirty: this.dirty,
    save: () => this.save(),
    discard: () => this.draft.set(this.mode()),
  };

  readonly choices: EmissionModeChoice[] = [
    { value: 'BOTH', titleKey: 'settings.fiscal.mode.both_title', descriptionKey: 'settings.fiscal.mode.both_description' },
    {
      value: 'ELECTRONIC',
      titleKey: 'settings.fiscal.mode.electronic_title',
      descriptionKey: 'settings.fiscal.mode.electronic_description',
    },
    {
      value: 'TRADITIONAL',
      titleKey: 'settings.fiscal.mode.traditional_title',
      descriptionKey: 'settings.fiscal.mode.traditional_description',
    },
  ];

  /** The market has both kinds: the mode means something here. */
  readonly applies = computed(() => this.context()?.emissionModeApplies === true);
  readonly authority = computed(() => this.context()?.fiscalAuthority ?? '—');
  readonly issuableNow = computed(() => (this.context()?.fiscalDocumentTypes ?? []).filter((t) => t.issuable));
  /** The market issues fiscal documents at all; elsewhere there is nothing to summarise. */
  readonly hasTypes = computed(() => (this.context()?.fiscalDocumentTypes ?? []).length > 0);

  /**
   * The mode is read once the server says the market has both kinds: a market with only one has no
   * mode to show, and asking for it would be a request for nothing.
   */
  private loaded = false;
  constructor() {
    effect(() => {
      if (!this.applies() || this.loaded) return;
      this.loaded = true;
      untracked(() => this.loadMode());
    });
    if (this.shell) {
      this.shell.register(this.changes);
      inject(DestroyRef).onDestroy(() => this.shell?.unregister(this.changes));
    }
  }

  /**
   * Each missing requirement in this market's words, with where it is met. The server says it in
   * words fit for any screen and any country («… o Facturación electrónica, según tu país»); here
   * the page is known, so the item names the place and takes the reader there (CONT-03).
   */
  gapItem(gap: string): GapItem {
    switch (gap) {
      case 'invoices.gaps.fiscal_sequence':
        return { textKey: 'settings.fiscal.gap.range_any', target: 'range-type', actionKey: 'settings.fiscal.gap.register_range' };
      case 'invoices.gaps.fiscal_sequence_electronic':
        return { textKey: 'settings.fiscal.gap.range_e', target: 'range-type', actionKey: 'settings.fiscal.gap.register_range' };
      case 'invoices.gaps.fiscal_sequence_traditional':
        return { textKey: 'settings.fiscal.gap.range_b', target: 'range-type', actionKey: 'settings.fiscal.gap.register_range' };
      case 'invoices.gaps.issuer_tax_id':
        return {
          textKey: 'settings.fiscal.gap.tax_id',
          params: { label: this.context()?.taxIdLabel || '—' },
          fragment: 'settings/profile',
          actionKey: 'settings.sections_meta.profile.label',
        };
      case 'invoices.gaps.signing_certificate':
        return { textKey: 'settings.fiscal.gap.certificate', target: 'cert-alias', actionKey: 'settings.fiscal.gap.upload_certificate' };
      default:
        return { textKey: gap };
    }
  }

  /** Takes the reader to the control on this page where the requirement is met. */
  goTo(id: string): void {
    const element = document.getElementById(id);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.focus({ preventScroll: true });
  }

  private loadMode(): void {
    this.organizationSettings.get('fiscal').subscribe({
      next: (view) => {
        const mode = view.fields['fiscalEmissionMode'];
        if (mode === 'BOTH' || mode === 'ELECTRONIC' || mode === 'TRADITIONAL') {
          this.mode.set(mode);
          this.draft.set(mode);
          this.modeChange.emit(mode);
        }
      },
      error: () => this.notifications.showError('settings.fiscal.mode.load_failed'),
    });
  }

  /** Choose how the company issues; it takes effect with «Guardar» in the save bar. */
  select(mode: FiscalEmissionMode): void {
    if (this.readonly() || this.saving()) return;
    this.draft.set(mode);
  }

  save(): Promise<boolean> {
    const mode = this.draft();
    if (!this.dirty() || this.readonly()) return Promise.resolve(false);
    this.saving.set(true);
    return new Promise((resolve) => {
      this.organizationSettings.update('fiscal', { fields: { fiscalEmissionMode: mode } }).subscribe({
        next: () => {
          this.saving.set(false);
          this.mode.set(mode);
          this.modeChange.emit(mode);
          this.changed.emit();
          this.notifications.showSuccess('settings.fiscal.mode.saved');
          resolve(true);
        },
        error: (err) => {
          this.saving.set(false);
          this.notifications.showHttpError(err, 'settings.fiscal.mode.save_failed');
          resolve(false);
        },
      });
    });
  }
}
