/**
 * Las primitivas compartidas de interfaz, en un solo sitio.
 *
 *     import { VX_UI } from '../../shared/components';
 *
 *     imports: [ReactiveFormsModule, ...VX_UI, ...VX_FORM_A11Y]
 *
 * ## Por qué un barril y no imports sueltos
 *
 * Por lo mismo que `gestures/index.ts`: quien busca «cómo se hace una insignia de estado aquí»
 * encuentra la respuesta entera, y añadir una décima primitiva obliga a tocar este índice, que es
 * donde se ve si debería existir. La auditoría de componentización encontró diez definiciones
 * rivales de `.status-badge` y dieciséis animaciones de giro escritas a mano precisamente porque
 * no había ningún sitio donde mirar antes de escribir la undécima.
 *
 * Los ARMAZONES DE GESTO no están aquí. Son otra cosa: marcan la forma de una pantalla entera y
 * viven en `gestures/`, con su propia prueba de conformidad.
 */
import { VxAmountComponent } from './amount';
import { VxBadgeComponent } from './badge';
import { VX_DATE } from './date';
import { VxDialogComponent } from './dialog';
import { VX_FEEDBACK } from './feedback';
import { VxPagerComponent } from './pager';
import { VX_SELECT } from './select';
import { VxTabsComponent } from './tabs';

export * from './amount';
export * from './badge';
export * from './date';
export * from './dialog';
export * from './feedback';
export * from './pager';
export * from './select';
export * from './tabs';

export const VX_UI = [
  VxAmountComponent,
  VxBadgeComponent,
  ...VX_DATE,
  VxDialogComponent,
  ...VX_FEEDBACK,
  VxPagerComponent,
  ...VX_SELECT,
  VxTabsComponent,
] as const;
