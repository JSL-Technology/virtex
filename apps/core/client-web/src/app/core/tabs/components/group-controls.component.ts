import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import {
  LucideAngularModule, SplitSquareHorizontal, Maximize2, Minimize2, PictureInPicture2, ExternalLink,
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
    @if (modes.showsTabs()) {
      <div class="group-controls">
        <!--
          Sacar a ventana está SIEMPRE a un clic (no solo en Taller): es la acción de una sola ventana
          —llevar un documento a otro monitor— y esconderla hasta cambiar de modo la hacía parecer
          inexistente. Dividir, flotar y maximizar sí son «disponer varias ventanas», así que son del
          Taller; y solo valen sobre un grupo de la rejilla —no un flotante ni un pop-out—, donde
          maximizar reventaba con «Invalid grid element».
        -->
        @if (modes.canTile() && inGrid()) {
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
        }
        <button
          type="button"
          class="gc-btn"
          [title]="'TABS.POPOUT' | translate"
          [attr.aria-label]="'TABS.POPOUT' | translate"
          (click)="popout()"
        >
          <lucide-icon [img]="PopoutIcon" size="15" aria-hidden="true"></lucide-icon>
        </button>
        @if (modes.canTile() && inGrid()) {
          <button
            type="button"
            class="gc-btn"
            [title]="(maximized() ? 'TABS.RESTORE' : 'TABS.MAXIMIZE') | translate"
            [attr.aria-label]="(maximized() ? 'TABS.RESTORE' : 'TABS.MAXIMIZE') | translate"
            (click)="toggleMaximize()"
          >
            <lucide-icon [img]="maximized() ? RestoreIcon : MaximizeIcon" size="15" aria-hidden="true"></lucide-icon>
          </button>
        }
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
  protected readonly PopoutIcon = ExternalLink;
  protected readonly MaximizeIcon = Maximize2;
  protected readonly RestoreIcon = Minimize2;

  /**
   * ¿El grupo vive en la rejilla principal? Dividir, flotar y —sobre todo— maximizar solo son
   * válidos ahí: sobre un grupo ya flotante o en pop-out, `getGridLocation` no encuentra la rejilla
   * y Dockview lanza «Invalid grid element». Es el guardián del arreglo.
   */
  protected inGrid(): boolean {
    return this.group?.api?.location?.type === 'grid';
  }

  splitRight(): void {
    const panel = this.activePanel ?? this.group?.model.activePanel;
    if (!panel || !this.containerApi || !this.inGrid()) return;
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
    if (!panel || !this.containerApi || !this.inGrid()) return;
    this.containerApi.addFloatingGroup(panel, {
      position: { top: 80, left: 120 },
      width: 640,
      height: 480,
    });
  }

  /**
   * Sacar la ventana activa a una ventana nativa del sistema operativo.
   *
   * Es el flotante llevado fuera del navegador: útil en dos monitores, y sin ceder el ancho del área
   * principal. Dockview la controla desde la misma app, así que conserva sesión y estado.
   */
  popout(): void {
    const panel = this.activePanel ?? this.group?.model.activePanel;
    if (!panel || !this.containerApi) return;
    try {
      void this.containerApi.addPopoutGroup(panel, {
        popoutUrl: '/popout.html',
        position: { left: 120, top: 80, width: 900, height: 640 },
      });
    } catch {
      //  El navegador puede bloquear la ventana sin un gesto directo; el botón lo es, así que en la
      //  práctica no ocurre. Si ocurre, no rompe nada.
    }
  }

  /**
   * Maximiza/restaura ESTE grupo con la API por grupo (`group.api`), no la global por panel: es la
   * que corresponde a la rejilla y evita pasar un panel de un grupo detached. Solo actúa si el grupo
   * está en la rejilla (`inGrid`), que es la condición que Dockview exige para maximizar.
   */
  toggleMaximize(): void {
    const group = this.group;
    if (!group || !this.inGrid()) return;
    if (group.api.isMaximized()) {
      group.api.exitMaximized();
      this.maximized.set(false);
    } else {
      group.api.maximize();
      this.maximized.set(true);
    }
  }
}
