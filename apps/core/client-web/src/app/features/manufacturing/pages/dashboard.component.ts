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
  selector: 'app-manufacturing-dashboard',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="roadmap">
      <header class="roadmap__head">
        <h1>{{ 'roadmap.manufacturing.title' | translate }}</h1>
        <span class="roadmap__badge">{{ 'roadmap.coming_soon' | translate }}</span>
      </header>
      <div class="roadmap__grid roadmap__grid--3">
        <article class="roadmap__card">
          <h2>{{ 'roadmap.manufacturing.production_orders.title' | translate }}</h2>
          <p>{{ 'roadmap.manufacturing.production_orders.description' | translate }}</p>
        </article>
        <article class="roadmap__card">
          <h2>{{ 'roadmap.manufacturing.bill_of_materials.title' | translate }}</h2>
          <p>{{ 'roadmap.manufacturing.bill_of_materials.description' | translate }}</p>
        </article>
        <article class="roadmap__card">
          <h2>{{ 'roadmap.manufacturing.work_centers.title' | translate }}</h2>
          <p>{{ 'roadmap.manufacturing.work_centers.description' | translate }}</p>
        </article>
      </div>
    </section>
  `,
  styleUrl: './roadmap.component.scss',
})
export class ManufacturingDashboardComponent {}
