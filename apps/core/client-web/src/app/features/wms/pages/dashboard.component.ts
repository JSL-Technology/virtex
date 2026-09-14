import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * What this module will do, said in the reader's language.
 *
 * A roadmap panel rather than a working screen — it is reachable from the sidebar because customers
 * ask what is coming, and saying "coming soon" is more honest than hiding the entry. Every string
 * used to be an English literal in this template, which is how an otherwise Spanish product showed
 * "Manufacturing & Production (MRP)" to a reader in Santo Domingo. The scanner never caught it,
 * because it only read `.html` files and this is an inline template.
 */
@Component({
  selector: 'app-wms-dashboard',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="roadmap">
      <header class="roadmap__head">
        <h1>{{ 'roadmap.wms.title' | translate }}</h1>
        <span class="roadmap__badge">{{ 'roadmap.coming_soon' | translate }}</span>
      </header>
      <div class="roadmap__grid roadmap__grid--2">
        <article class="roadmap__card">
          <h2>{{ 'roadmap.wms.realtime_inventory.title' | translate }}</h2>
          <p>{{ 'roadmap.wms.realtime_inventory.description' | translate }}</p>
        </article>
        <article class="roadmap__card">
          <h2>{{ 'roadmap.wms.landed_costs.title' | translate }}</h2>
          <p>{{ 'roadmap.wms.landed_costs.description' | translate }}</p>
        </article>
      </div>
    </section>
  `,
  styleUrl: './roadmap.component.scss',
})
export class WmsDashboardComponent {}
