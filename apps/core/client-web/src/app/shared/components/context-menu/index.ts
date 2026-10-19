/**
 * Menú contextual (clic derecho) para la aplicación.
 *
 *     import { VX_CONTEXT_MENU, ListMenuConfig, ListSelectionService } from '.../context-menu';
 *
 *     // en la página:
 *     imports: [..., ...VX_CONTEXT_MENU]
 *     providers: [ListSelectionService]           // sólo si quiere acciones en lote
 *
 *     // en el template:
 *     <table [appTableMenu]="miMenu" #m="appTableMenu">
 *       <tr appRowLink [appRowMenu]="fila"> … </tr>
 *     </table>
 *
 * El host (`<vx-context-menu>`) se monta UNA vez en `app.html`; no va por página.
 */
export * from './context-menu.types';
export * from './context-menu.service';
export * from './list-selection.service';
export * from './context-menu-item.component';
export * from './context-menu.component';
export * from './table-menu.directive';
export * from './row-menu.directive';

import { TableMenuDirective } from './table-menu.directive';
import { RowMenuDirective } from './row-menu.directive';

/** Las directivas a añadir a los `imports` de una página con tabla. */
export const VX_CONTEXT_MENU = [TableMenuDirective, RowMenuDirective] as const;
