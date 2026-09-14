import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * What this module will do, said in the reader's language.
 *
 * A roadmap panel rather than a working screen — it is reachable from the sidebar because customers
 * ask what is coming, and saying "coming soon" is more honest than hiding the entry. Every string
 * used to be an English literal in this template, in an otherwise Spanish product. The scanner never
 * caught it because it only read `.html` files and this is an inline template.
 */
@Component({
  selector: 'app-procurement-dashboard',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="roadmap">
      <header class="roadmap__head">
        <h1>{{ 'roadmap.procurement.title' | translate }}</h1>
        <span class="roadmap__badge">{{ 'roadmap.coming_soon' | translate }}</span>
      </header>
      <p class="roadmap__lede">{{ 'roadmap.procurement.description' | translate }}</p>
    </section>
  `,
  styleUrl: './roadmap.component.scss',
})
export class ProcurementDashboardComponent {}
