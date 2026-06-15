import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule, SplitSquareHorizontal, Maximize2, Minimize2,
} from 'lucide-angular';
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from 'dockview-angular';

/**
 * Acciones del encabezado de cada grupo de Dockview (lado derecho).
 * Permite dividir el panel activo en una nueva ventana lateral y
 * maximizar/restaurar el grupo (TAB_ARCHITECTURE §11 — sistema de ventanas
 * avanzado: una al lado de la otra + expandir).
 *
 * Dockview asigna las props de `IDockviewHeaderActionsProps` como propiedades
 * de la instancia (api, containerApi, panels, activePanel, isGroupActive, group…).
 */
@Component({
  selector: 'app-group-controls',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="group-controls">
      <button
        type="button"
        class="gc-btn"
        title="Dividir a la derecha"
        aria-label="Dividir a la derecha"
        (click)="splitRight()"
      >
        <lucide-icon [img]="SplitIcon" size="15"></lucide-icon>
      </button>
      <button
        type="button"
        class="gc-btn"
        [title]="maximized() ? 'Restaurar' : 'Maximizar'"
        [attr.aria-label]="maximized() ? 'Restaurar' : 'Maximizar'"
        (click)="toggleMaximize()"
      >
        <lucide-icon [img]="maximized() ? RestoreIcon : MaximizeIcon" size="15"></lucide-icon>
      </button>
    </div>
  `,
  styles: [`
    .group-controls {
      display: flex;
      align-items: center;
      gap: 2px;
      height: 100%;
      padding: 0 4px;
    }
    .gc-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-tertiary);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .gc-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  `],
})
export class GroupControlsComponent {
  /** Inyectados por Dockview (IDockviewHeaderActionsProps). */
  containerApi!: DockviewApi;
  group!: DockviewGroupPanel;
  activePanel?: IDockviewPanel;

  readonly maximized = signal(false);

  protected readonly SplitIcon = SplitSquareHorizontal;
  protected readonly MaximizeIcon = Maximize2;
  protected readonly RestoreIcon = Minimize2;

  splitRight(): void {
    const panel = this.activePanel ?? this.group?.model.activePanel;
    if (!panel || !this.containerApi) return;
    // Si el grupo solo tiene un panel, dividir no aporta nada útil.
    if (this.group.model.panels.length <= 1) return;
    const newGroup = this.containerApi.addGroup({
      referenceGroup: this.group,
      direction: 'right',
    });
    panel.api.moveTo({ group: newGroup });
  }

  toggleMaximize(): void {
    const api = this.containerApi;
    if (!api) return;
    if (api.hasMaximizedGroup()) {
      api.exitMaximizedGroup();
      this.maximized.set(false);
    } else {
      const panel = this.activePanel ?? this.group?.model.activePanel;
      if (panel) {
        api.maximizeGroup(panel);
        this.maximized.set(true);
      }
    }
  }
}
