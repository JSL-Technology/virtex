import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LucideAngularModule, ExternalLink, ScanBarcode, Banknote, ClipboardCheck, Printer } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { POS_URL } from '../../../core/tokens/pos-url';

/**
 * The point of sale's place in the ERP: a door to the till, not the till.
 *
 * Selling used to happen in a screen embedded here, and in a separate application at the same
 * time — two tills with different features, rules and bugs. The till is now one application,
 * `apps/pos`, deployed apart from the ERP. This window stays at `sales/pos` so the menu entry,
 * bookmarks and restored tabs keep working; it says where selling went and opens it — with the same
 * session, since both applications share the origin.
 */
@Component({
  selector: 'app-pos-launcher-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="launcher">
      <div class="launcher__card">
        <h1>{{ 'page_titles.point_of_sale' | translate }}</h1>
        <p class="launcher__lead">{{ 'sales.pos_launcher.lead' | translate }}</p>
        <ul class="launcher__features">
          <li><lucide-icon [img]="ScanIcon" size="18" aria-hidden="true"></lucide-icon>{{ 'sales.pos_launcher.feature_scan' | translate }}</li>
          <li><lucide-icon [img]="CashIcon" size="18" aria-hidden="true"></lucide-icon>{{ 'sales.pos_launcher.feature_payments' | translate }}</li>
          <li><lucide-icon [img]="ShiftIcon" size="18" aria-hidden="true"></lucide-icon>{{ 'sales.pos_launcher.feature_shift' | translate }}</li>
          <li><lucide-icon [img]="PrintIcon" size="18" aria-hidden="true"></lucide-icon>{{ 'sales.pos_launcher.feature_receipts' | translate }}</li>
        </ul>
        <div class="launcher__actions">
          <a class="primary-button" [href]="posUrl" target="_blank" rel="noopener" data-testid="open-pos">
            <lucide-icon [img]="OpenIcon" size="16" aria-hidden="true"></lucide-icon>
            <span>{{ 'sales.pos_launcher.open' | translate }}</span>
          </a>
          <a class="secondary-button" routerLink="/sales/history">{{ 'page_titles.pos_tickets' | translate }}</a>
        </div>
        <p class="launcher__note">{{ 'sales.pos_launcher.same_session' | translate }}</p>
      </div>
    </section>
  `,
  styles: [
    `
      .launcher { display: grid; place-items: center; min-height: 100%; padding: var(--space-6); }
      .launcher__card { max-width: 560px; width: 100%; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-4); }
      h1 { margin: 0; font-size: var(--text-xl, 1.4rem); color: var(--text-primary); }
      .launcher__lead { margin: 0; color: var(--text-secondary); }
      .launcher__features { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); color: var(--text-primary); }
      .launcher__features li { display: flex; align-items: center; gap: var(--space-2); }
      .launcher__features lucide-icon { color: var(--accent-primary); }
      .launcher__actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
      .launcher__actions a { text-decoration: none; }
      .launcher__note { margin: 0; color: var(--text-tertiary); font-size: var(--text-sm); }
    `,
  ],
})
export class PosLauncherPage {
  protected readonly posUrl = POS_URL;
  protected readonly OpenIcon = ExternalLink;
  protected readonly ScanIcon = ScanBarcode;
  protected readonly CashIcon = Banknote;
  protected readonly ShiftIcon = ClipboardCheck;
  protected readonly PrintIcon = Printer;
}
