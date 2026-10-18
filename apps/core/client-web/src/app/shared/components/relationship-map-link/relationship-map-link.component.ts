import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, Share2 } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';

/** The permission that opens the map. The map itself then filters each document by its module's. */
export const RELATIONSHIP_MAP_PERMISSION = 'relationship_map:view';

/** Where a document's map lives. Kept here so every caller builds the same address. */
export function relationshipMapPath(type: string, id: string): string {
  return `reports/relationship-map/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
}

/**
 * «Mapa de relaciones» — the button SAP Business One puts on every document's toolbar.
 *
 * It opens (or focuses) the map of THIS document in its own tab: the quotation it came from, the
 * receipt that paid it, the entry it posted. The document shells render it themselves when given a
 * type and id, so a screen opts in with two attributes rather than wiring a button; a screen with
 * its own toolbar can place it directly.
 *
 * It renders nothing for someone without the map permission, and nothing for a document that does
 * not exist yet (a new draft has no chain).
 */
@Component({
  selector: 'vx-relationship-map-link',
  standalone: true,
  imports: [TranslatePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./relationship-map-link.component.scss'],
  template: `
    @if (visible()) {
      <button
        type="button"
        class="rml"
        [class.rml--icon]="compact()"
        [title]="'relationship_map.open_hint' | translate"
        [attr.aria-label]="'relationship_map.title' | translate"
        (click)="open()"
      >
        <lucide-icon [img]="Icon" size="16" aria-hidden="true"></lucide-icon>
        @if (!compact()) {
          <span>{{ 'relationship_map.title' | translate }}</span>
        }
      </button>
    }
  `,
})
export class RelationshipMapLinkComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly tenancy = inject(ActiveOrganizationService);

  /** Document type as the map names it: `SALES_INVOICE`, `PURCHASE_ORDER`… */
  readonly type = input.required<string>();
  readonly documentId = input<string | null | undefined>(null);
  /** Icon only, for a crowded toolbar. */
  readonly compact = input(false);

  protected readonly Icon = Share2;

  protected readonly visible = computed(
    () => !!this.documentId() && !!this.type() && this.auth.hasPermissions([RELATIONSHIP_MAP_PERMISSION]),
  );

  open(): void {
    const id = this.documentId();
    if (!id) return;
    void this.router.navigateByUrl(this.tenancy.urlFor(relationshipMapPath(this.type(), id)));
  }
}
