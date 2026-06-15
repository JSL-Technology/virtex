import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Construction } from 'lucide-angular';
import { TAB_CONTEXT } from '../tab-context';

/**
 * Página de relleno usada cuando una ruta del sidebar todavía no tiene una
 * página real implementada. Garantiza que NINGÚN clic del sidebar quede muerto
 * (TAB_ARCHITECTURE §5.3 / §12 P0-1): siempre se abre una pestaña con un estado
 * "en construcción" claro y elegante, coherente con el tema claro/oscuro.
 */
@Component({
  selector: 'app-generic-module-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="generic-page">
      <div class="generic-card">
        <div class="generic-icon">
          <lucide-icon [img]="ConstructionIcon" size="34"></lucide-icon>
        </div>
        <h1 class="generic-title">{{ title() }}</h1>
        <p class="generic-subtitle">
          Este módulo está en construcción. La ruta se ha registrado y la pestaña
          funciona correctamente; la vista detallada estará disponible pronto.
        </p>
        <code class="generic-route">{{ route() }}</code>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; width: 100%; }

    .generic-page {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      width: 100%;
      padding: 2rem;
      background:
        radial-gradient(120% 120% at 50% 0%, var(--bg-tertiary) 0%, var(--bg-primary) 60%);
    }

    .generic-card {
      max-width: 460px;
      text-align: center;
      padding: 2.5rem 2rem;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
    }

    .generic-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 76px;
      height: 76px;
      margin-bottom: 1.25rem;
      border-radius: 50%;
      color: var(--accent-primary);
      background: var(--primary-light);
    }

    .generic-title {
      margin: 0 0 0.5rem;
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }

    .generic-subtitle {
      margin: 0 0 1.5rem;
      font-size: 0.92rem;
      line-height: 1.55;
      color: var(--text-secondary);
    }

    .generic-route {
      display: inline-block;
      padding: 0.4rem 0.75rem;
      font-family: 'Consolas', 'SFMono-Regular', monospace;
      font-size: 0.82rem;
      color: var(--text-secondary);
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
    }
  `],
})
export class GenericModulePage {
  private ctx = inject(TAB_CONTEXT, { optional: true });

  readonly title = computed(() => this.ctx?.title || this.prettify(this.ctx?.route));
  readonly route = computed(() => this.ctx?.route || '/');

  protected readonly ConstructionIcon = Construction;

  private prettify(route?: string): string {
    if (!route) return 'Módulo';
    const last = route.split('/').filter(Boolean).pop() ?? 'Módulo';
    return last
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
