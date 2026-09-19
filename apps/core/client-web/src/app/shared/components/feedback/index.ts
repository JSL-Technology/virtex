/**
 * Los tres estados que una pantalla tiene además del normal.
 *
 * Se exportan juntos porque nunca hace falta uno solo: quien pinta datos que llegan por red
 * necesita decir que están llegando, que no hay, o que falló. Importar los tres de golpe hace
 * que olvidarse de uno sea visible.
 */
import { VxSpinnerComponent } from './spinner.component';
import { VxEmptyStateComponent } from './empty-state.component';
import { VxErrorStateComponent } from './error-state.component';

export { VxSpinnerComponent } from './spinner.component';
export { VxEmptyStateComponent } from './empty-state.component';
export { VxErrorStateComponent } from './error-state.component';

export const VX_FEEDBACK = [
  VxSpinnerComponent,
  VxEmptyStateComponent,
  VxErrorStateComponent,
] as const;
