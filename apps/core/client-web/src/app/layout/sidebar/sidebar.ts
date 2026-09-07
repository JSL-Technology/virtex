import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule } from 'lucide-angular';

import { ActiveModuleService } from '../../core/modules/active-module.service';

/**
 * The module panel: what there is to do inside the module you are in.
 *
 * ## Why it no longer lists the whole product
 *
 * It used to render every module's entries flattened into one scrolling column — around fifty
 * links under ten headings — so finding anything meant holding the entire ERP in your head. The
 * rail now answers "which part of the business", and this panel answers "what inside it", which is
 * a short question. Nothing was removed: every destination is still two clicks away.
 *
 * ## Why the four groups are fixed and always in the same order
 *
 * Bandeja · Documentos · Maestros · Análisis appear in that order in every module, and a module
 * with nothing in a group omits the heading rather than reordering the rest. That fixed shape is
 * what makes the second module cost nothing to learn: whatever the module, what needs your
 * attention is at the top and the reference data is where it was next door.
 *
 * The component holds no logic of its own on purpose. What to show is `ActiveModuleService.panel()`
 * — already resolved from the URL, already filtered to this seat's permissions — because the top
 * bar's mega-menu shows the same thing, and two renderings of one menu must not be able to disagree
 * about what it contains.
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterModule, TranslateModule, LucideAngularModule],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar {
  private readonly modules = inject(ActiveModuleService);

  /** The module whose panel is on screen. Derived from the URL, never stored. */
  protected readonly module = this.modules.active;

  /** Its four groups, in fixed order, holding only what this seat may open. */
  protected readonly sections = this.modules.panel;

  /** Longest declared entry path that prefixes the URL — exactly one entry is lit. */
  protected readonly activeEntry = this.modules.activeEntry;
}
