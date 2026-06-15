import { Component, ChangeDetectionStrategy } from '@angular/core';

/**
 * Componente vacío usado como destino de la ruta comodín bajo `MainLayout`.
 *
 * El contenido real del workspace lo renderiza `TabContainerComponent` (Dockview),
 * NO un `<router-outlet>`. Esta ruta solo existe para que CUALQUIER ruta del
 * sidebar/ERP haga *match* y produzca un `NavigationEnd`, de modo que el puente
 * Router↔Workspace abra/enfoque la pestaña correspondiente sin redirecciones a
 * la pantalla de login (TAB_ARCHITECTURE §2, §5.3, §12 P0-1).
 */
@Component({
  selector: 'app-workspace-blank',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class WorkspaceBlankComponent {}
