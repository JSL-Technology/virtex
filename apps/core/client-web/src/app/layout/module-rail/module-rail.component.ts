import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Lock } from 'lucide-angular';
import { ActiveModuleService, ReachableModule } from '../../core/modules/active-module.service';
import { moduleIcon } from '../../core/modules/module-icons';
import { ModuleInboxService } from '../../core/inbox/module-inbox.service';

/** One strip entry: what the shell already computed, plus the drawing. */
interface RailItem extends ReachableModule {
  readonly icon: unknown;
  /**
   * Cuántas cosas esperan en este módulo.
   *
   * Es el número que permite saber dónde hay trabajo sin entrar a mirar, que es exactamente lo
   * que un riel de diez módulos no podía decir: había que abrirlos uno a uno.
   */
  readonly pending: number;
}

/**
 * The module division, made visible and primary.
 *
 * ## Why a rail rather than more groups in one list
 *
 * A single scrolling list of every destination makes the reader hold the whole product in their
 * head to find anything. The rail turns that into two decisions — which part of the business, then
 * what inside it — and the second one is short. It also means the panel beside it can keep the same
 * four groups in the same order for every module, which is what makes the second module cost
 * nothing to learn.
 *
 * ## Why modules the user cannot enter stay visible
 *
 * Hidden means unknown. Someone who cannot see that Manufacturing exists cannot ask for it, and
 * support gets the question instead. They appear dimmed with a lock, which is more honest than a
 * menu that quietly differs from one seat to the next.
 *
 * The strip is a `computed` over the shell's own `reachable()`, not a set of template method
 * calls: `buildMenu()` walks a module's routes, and calling it once per module per change
 * detection is work the reader pays for on every keystroke elsewhere in the shell. Sharing the
 * computation with the top-bar variant is also what keeps the two navigations from disagreeing
 * about which modules exist.
 */
@Component({
  selector: 'app-module-rail',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './module-rail.component.html',
  styleUrls: ['./module-rail.component.scss'],
})
export class ModuleRailComponent {
  private readonly router = inject(Router);
  private readonly modules = inject(ActiveModuleService);
  private readonly inbox = inject(ModuleInboxService);

  protected readonly LockIcon = Lock;

  protected readonly items = computed<RailItem[]>(() =>
    this.modules.reachable().map((entry) => ({
      ...entry,
      icon: moduleIcon(entry.module.icon),
      // Un módulo al que no se puede entrar no lleva número: decir que hay tres cosas pendientes
      // detrás de un candado es enseñar el tamaño de algo que no se puede abrir.
      pending: entry.allowed ? this.inbox.countFor(entry.module.id) : 0,
    })),
  );

  protected readonly activeId = computed(() => this.modules.active()?.id ?? null);

  protected open(item: RailItem): void {
    if (!item.allowed || !item.target) return;
    void this.router.navigateByUrl(item.target);
  }
}
