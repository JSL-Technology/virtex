import type { LucideIconData } from 'lucide-angular';
import type { KeyChord } from '../../../core/keyboard/keyboard-shortcuts';

/**
 * Qué se hizo clic. El motor es genérico: una fila de tabla, el cromo/vacío de la tabla, una celda
 * o —a futuro— la barra lateral o un texto seleccionado. El contenido del menú se resuelve a partir
 * de este contexto, que es lo que hace que «qué puedo hacer con esto» dependa de dónde se hizo clic.
 */
export type MenuContextKind = 'row' | 'table' | 'cell' | 'empty';

export interface MenuContext<E = unknown> {
  readonly kind: MenuContextKind;
  /** La entidad bajo el cursor, si la hay (la fila). */
  readonly entity?: E;
  /** Nunca vacío cuando hay fila: por defecto `[entity]`. Varias → acciones en lote. */
  readonly selection: readonly E[];
  /** El evento que abrió el menú: da la posición y los modificadores. */
  readonly event: MouseEvent | KeyboardEvent;
}

/** Una etiqueta traducible con parámetros, p.ej. «Eliminar {{n}}». */
export interface MenuLabel {
  key: string;
  params?: Record<string, unknown>;
}

/**
 * Una acción declarativa. El motor la pinta y la filtra; nunca sabe qué hace: eso lo decide `run`,
 * que es dueño de su confirmación (modal) y su feedback (toast). Así una tabla nueva declara sus
 * operaciones como DATOS y no reimplementa el menú.
 */
export interface MenuItem<C extends MenuContext = MenuContext> {
  id: string;
  /** Clave i18n, o función para un label dinámico dependiente del contexto. */
  label: string | ((ctx: C) => MenuLabel | string);
  icon?: LucideIconData;
  chord?: KeyChord;
  /** Se oculta si el usuario no tiene el/los permiso(s) (mismo criterio que `*appHasPermission`). */
  permission?: string | string[];
  /** Pinta la acción como destructiva (eliminar). */
  danger?: boolean;
  /** Un ítem con marca de verificación (p.ej. una vista o un filtro activo). */
  checked?: (ctx: C) => boolean;
  visible?: (ctx: C) => boolean;
  disabled?: (ctx: C) => boolean;
  submenu?: MenuItem<C>[];
  run?: (ctx: C) => void | Promise<void>;
}

/** Un grupo de ítems. El motor dibuja un separador entre secciones. */
export interface MenuSection<C extends MenuContext = MenuContext> {
  id: string;
  items: MenuItem<C>[];
}

/**
 * Lo que una página pasa a `[appTableMenu]`. Las acciones de tabla son estáticas; las de fila se
 * construyen al abrir, porque dependen de la entidad y de la selección vigente.
 */
export interface ListMenuConfig<E = unknown> {
  resource: string;
  table?: MenuSection<MenuContext<E>>[];
  row?: (ctx: MenuContext<E>) => MenuSection<MenuContext<E>>[];
}
