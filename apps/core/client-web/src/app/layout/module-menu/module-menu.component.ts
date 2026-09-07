import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule } from 'lucide-angular';
import { PanelSection } from '../../core/modules/active-module.service';

/**
 * A module's panel, laid out horizontally: the mega-menu of the top-bar shell.
 *
 * ## Why this exists at all
 *
 * `layoutStyle` is a tenant setting and its default is `topnav`, where the side panel is hidden.
 * Before this component, choosing the top bar meant each module offered exactly one destination —
 * whatever its first entry happened to be — and everything else in the module was unreachable
 * except by typing a URL. A navigation that depends on which cosmetic option the tenant picked is
 * not a navigation.
 *
 * ## Why the same four groups, in columns
 *
 * Bandeja · Documentos · Maestros · Análisis, in that order, exactly as the vertical panel shows
 * them — turned ninety degrees. Both read `ActiveModuleService`, so the two shells cannot describe
 * one module differently, and a user moving between a tenant on one setting and a tenant on the
 * other is not learning a second product.
 */
@Component({
  selector: 'app-module-menu',
  standalone: true,
  imports: [RouterModule, TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './module-menu.component.html',
  styleUrls: ['./module-menu.component.scss'],
})
export class ModuleMenuComponent {
  readonly sections = input.required<PanelSection[]>();
  readonly activeEntry = input<string | null>(null);

  /** Emitted after a destination is chosen, so the shell can close the menu. */
  readonly chosen = output<string>();
}
