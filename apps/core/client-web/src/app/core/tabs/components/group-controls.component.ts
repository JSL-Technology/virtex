import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import {
  LucideAngularModule, SplitSquareHorizontal, Maximize2, Minimize2, PictureInPicture2,
} from 'lucide-angular';
import { WindowModeService } from '../../windows/window-mode.service';
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
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
      Dividir, sacar a flotante y maximizar pertenecen al taller. En modo enfocado no se muestran:
      no están deshabilitadas, es que no forman parte de esa manera de trabajar.
    -->
    @if (modes.canTile()) {
      <div class="group-controls">
        <button
          type="button"
          class="gc-btn"
          [title]="'TABS.SPLIT_RIGHT' | translate"
          [attr.aria-label]="'TABS.SPLIT_RIGHT' | translate"
          (click)="splitRight()"
        >
          <lucide-icon [img]="SplitIcon" size="15" aria-hidden="true"></lucide-icon>
        </button>
        <button
          type="button"
          class="gc-btn"
          [title]="'TABS.FLOAT' | translate"
          [attr.aria-label]="'TABS.FLOAT' | translate"
          (click)="float()"
        >
          <lucide-icon [img]="FloatIcon" size="15" aria-hidden="true"></lucide-icon>
        </button>
        <button
          type="button"
          class="gc-btn"
          [title]="(maximized() ? 'TABS.RESTORE' : 'TABS.MAXIMIZE') | translate"
          [attr.aria-label]="(maximized() ? 'TABS.RESTORE' : 'TABS.MAXIMIZE') | translate"
          (click)="toggleMaximize()"
        >
          <lucide-icon [img]="maximized() ? RestoreIcon : MaximizeIcon" size="15" aria-hidden="true"></lucide-icon>
        </button>
      </div>
    }
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

  protected readonly modes = inject(WindowModeService);

  readonly maximized = signal(false);

  protected readonly SplitIcon = SplitSquareHorizontal;
  protected readonly FloatIcon = PictureInPicture2;
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

  /**
   * Sacar la ventana activa a flotante.
   *
   * A diferencia de dividir, esto SÍ aporta con un solo panel en el grupo: leer un asiento encima
   * de la factura que lo produjo es exactamente el caso, y dividir obligaría a ceder la mitad del
   * ancho a cada uno.
   */
  float(): void {
    const panel = this.activePanel ?? this.group?.model.activePanel;
    if (!panel || !this.containerApi) return;
    this.containerApi.addFloatingGroup(panel, {
      position: { top: 80, left: 120 },
      width: 640,
      height: 480,
    });
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
