import { SettingsShellService } from '../shell';
import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FiscalEmissionMode, InvoicesService, InvoicingContext } from '../../../core/services/invoices';
import { NotificationService } from '../../../core/services/notification';
import {
  FiscalDocumentTypeView,
  FiscalSettingsService,
  MarketCoverage,
} from '../../../core/api/fiscal-settings.service';
import { EmissionModeCardComponent, FiscalRangesCardComponent, SigningCertificateCardComponent } from './shared';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { VxBadgeComponent } from '../../../shared/components/badge';

/**
 * The company's fiscal documents: how it issues them, the ranges its authority granted, and the
 * certificate that signs the electronic ones — the same cards in every market (emission mode,
 * ranges, certificate), each driven by the market's catalogue and the server's answer.
 *
 * A company may issue traditional documents (numbered from an authorised range and printed,
 * nothing transmitted), electronic ones (signed with a certificate and sent to the authority), or
 * both while it moves from one to the other, where its market has both kinds.
 */
@Component({
  selector: 'app-fiscal-settings-page',
  standalone: true,
  imports: [CommonModule, TranslateModule, VxBadgeComponent, EmissionModeCardComponent, FiscalRangesCardComponent, SigningCertificateCardComponent],
  templateUrl: './fiscal.page.html',
  styleUrls: ['./fiscal.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiscalSettingsPage implements OnInit {
  /** Whether this person may change the fiscal set-up (`taxes:edit`); read only otherwise. */
  protected readonly canEdit = inject(SettingsShellService, { optional: true })?.canEdit ?? signal(true);

  private invoices = inject(InvoicesService);
  private notifications = inject(NotificationService);
  private fiscalSettings = inject(FiscalSettingsService);

  // ── How the company issues (`vx-emission-mode-card` reads and saves it) ──────────
  readonly emissionMode = signal<FiscalEmissionMode>('BOTH');

  /** What the invoice form will offer, as the server computes it: the page's live summary. */
  readonly invoicing = signal<InvoicingContext | null>(null);

  /**
   * The market's document types, from its catalogue (`GET localization/fiscal-document-types`): what
   * the ranges card offers a range for. Notes and buyer-issued types are there too — a range is
   * authorised for them as for any other.
   */
  readonly documentTypes = signal<FiscalDocumentTypeView[]>([]);

  /** What the product does and does not do in the tenant's market. */
  readonly coverage = signal<MarketCoverage | null>(null);

  /** `needs-credentials` → `settings.fiscal.level_needs_credentials`. */
  levelKey(level: string): string {
    return composeKey('settings.fiscal.level', level);
  }

  /** The badge tone of a coverage level: a state, not a sentence (QA U31). */
  levelTone(level: string): 'ok' | 'warning' | 'danger' | 'neutral' {
    switch (level) {
      case 'implemented':
        return 'ok';
      case 'needs-credentials':
      case 'needs-configuration':
        return 'warning';
      case 'not-implemented':
        return 'danger';
      // The law asks for nothing here: neither an achievement nor a gap.
      case 'not-applicable':
      default:
        return 'neutral';
    }
  }

  /** `taxDetermination` → `settings.fiscal.tax_determination`. */
  capabilityKey(capability: string): string {
    return composeKey('settings.fiscal.capability', capability);
  }

  ngOnInit(): void {
    this.loadInvoicingState();

    this.fiscalSettings.documentTypes().subscribe({
      next: (types) => this.documentTypes.set(types),
      error: () => this.notifications.showError('settings.fiscal.document_types_load_failed'),
    });

    this.fiscalSettings.coverage().subscribe({
      next: (market) => this.coverage.set(market),
      // Context, not the point of the page.
      error: () => this.coverage.set(null),
    });
  }

  /** The emission-mode card read or changed the mode: the ranges card follows it. */
  onModeChange(mode: FiscalEmissionMode): void {
    this.emissionMode.set(mode);
  }

  /** Something the issue readiness depends on changed: read it again. */
  refreshInvoicingState(): void {
    this.loadInvoicingState();
  }

  private loadInvoicingState(): void {
    this.invoices.context().subscribe({
      next: (context) => this.invoicing.set(context),
      // A summary, not the point of the page.
      error: () => this.invoicing.set(null),
    });
  }
}
