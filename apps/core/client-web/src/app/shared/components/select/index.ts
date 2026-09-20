/**
 * El campo de selección compartido.
 *
 *     import { VX_SELECT } from '../../shared/components/select';
 *
 *     imports: [ReactiveFormsModule, ...VX_SELECT, ...VX_FORM_A11Y]
 *
 * Se exporta como arreglo —y no solo las clases sueltas— para que la directiva de plantilla de
 * opción viaje siempre con el componente: un llamante que importe uno sin el otro tiene una
 * plantilla que compila y no pinta nada.
 */
import { VxSelectComponent } from './select.component';
import { VxSelectOptionDirective } from './select-option.directive';

export * from './select.types';
export * from './select.component';
export * from './select-option.directive';

export const VX_SELECT = [VxSelectComponent, VxSelectOptionDirective] as const;
