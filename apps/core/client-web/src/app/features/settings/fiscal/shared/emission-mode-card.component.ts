import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { FiscalEmissionMode, InvoicingContext } from '../../../../core/services/invoices';
import { NotificationService } from '../../../../core/services/notification';
import { OrganizationSettingsService } from '../../data/organization-settings.service';
import { VxBadgeComponent } from '../../../../shared/components/badge';

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
  imports: [TranslatePipe, VxBadgeComponent],
  templateUrl: './emission-mode-card.component.html',
  styleUrls: ['./emission-mode-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmissionModeCardComponent {
  private readonly organizationSettings = inject(OrganizationSettingsService);
  private readonly notifications = inject(NotificationService);

  /** What the invoice form will offer, as the server computes it. */
  readonly context = input<InvoicingContext | null>(null);
  /** The mode, once read and every time it is changed. */
  readonly modeChange = output<FiscalEmissionMode>();
  /** The mode was saved: whatever depends on it should be read again. */
  readonly changed = output<void>();

  readonly mode = signal<FiscalEmissionMode>('BOTH');
  readonly saving = signal(false);

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
  }

  private loadMode(): void {
    this.organizationSettings.get('fiscal').subscribe({
      next: (view) => {
        const mode = view.fields['fiscalEmissionMode'];
        if (mode === 'BOTH' || mode === 'ELECTRONIC' || mode === 'TRADITIONAL') {
          this.mode.set(mode);
          this.modeChange.emit(mode);
        }
      },
      error: () => this.notifications.showError('settings.fiscal.mode.load_failed'),
    });
  }

  /** Change how the company issues. Saved at once: it is one choice, not a form. */
  select(mode: FiscalEmissionMode): void {
    if (mode === this.mode() || this.saving()) return;
    const previous = this.mode();
    this.mode.set(mode);
    this.saving.set(true);
    this.organizationSettings.update('fiscal', { fields: { fiscalEmissionMode: mode } }).subscribe({
      next: () => {
        this.saving.set(false);
        this.modeChange.emit(mode);
        this.changed.emit();
        this.notifications.showSuccess('settings.fiscal.mode.saved');
      },
      error: (err) => {
        this.mode.set(previous);
        this.saving.set(false);
        this.notifications.showHttpError(err, 'settings.fiscal.mode.save_failed');
      },
    });
  }
}
