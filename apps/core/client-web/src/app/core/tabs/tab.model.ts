import { Type } from '@angular/core';

export enum TabType {
  PINNED = 'PINNED',
  MODULE_LIST = 'MODULE_LIST',
  RECORD = 'RECORD',
  WIZARD = 'WIZARD',
  REPORT = 'REPORT',
  UTILITY = 'UTILITY',
}

export interface TabModel {
  // Identidad
  id: string;                    // UUID único por instancia: "tab_a8f2..."
  type: TabType;

  // Presentación
  title: string;                 // "Factura #00123"
  icon: string;                  // nombre de icono lucide ("Receipt")
  badge?: number;                // Notificaciones dentro de la pestaña

  // Ruta asociada (fuente para reabrir/rehidratar)
  route: string;                 // "/invoices/123"
  routeParams: Record<string, string>;  // { id: '123' }
  queryParams?: Record<string, string>;

  // Estado
  isDirty: boolean;              // Cambios sin guardar
  isLoading: boolean;            // Cargando datos
  isCloseable: boolean;          // Si puede cerrarse
  isPinned: boolean;             // Si está fijada

  // Control de instancias (deduplicación)
  entityKey?: string;            // "invoice:123" | "module:invoices"

  // Ciclo de vida
  createdAt: Date;
  lastActivatedAt: Date;
  scrollPosition?: number;       // ⊕ restaurar scroll
  viewState?: unknown;           // ⊕ estado serializable de la vista (filtros, paso de wizard…)

  // ⊕ Orden explícito para drag & drop / pin
  order?: number;
}

export interface OpenTabConfig {
  route: string;
  routeParams?: Record<string, string>;
  queryParams?: Record<string, string>;
  title?: string;
  icon?: string;
  /** Si es false, abre la pestaña sin activarla (apertura en segundo plano). */
  activate?: boolean;
  /** Marca la pestaña como cargando hasta que su componente resuelva datos. */
  isLoading?: boolean;
}

/**
 * Definición declarativa de una pestaña, asociada a un patrón de ruta.
 * Usa `load()` perezoso (alineado con loadComponent de las rutas) para no
 * romper el lazy-loading (TAB_ARCHITECTURE §5.2).
 */
export interface TabDefinition {
  pattern: string;                                   // '/invoices/:id'
  tabType: TabType;
  load: () => Promise<Type<unknown>>;                // carga perezosa del componente
  title?: string;
  icon?: string;
  isCloseable?: boolean;
  permissions?: string[];                            // espejo del permissionsGuard
  entityKeyFn?: (params: Record<string, string>, q?: Record<string, string>) => string;
  titleFn?: (params: Record<string, string>, data?: unknown) => string;
}

/**
 * Contrato opcional para páginas-pestaña. Dockview NO destruye el DOM de las
 * pestañas inactivas, por lo que las páginas deben pausar/reanudar trabajo
 * costoso (polling, websockets, timers) mediante estos hooks (§7.1).
 */
export interface TabAware {
  onTabActivated?(): void;     // reanudar subscripciones, refrescar si stale
  onTabDeactivated?(): void;   // pausar polling, persistir viewState
}

/** Type guard para detectar componentes que implementan TabAware. */
export function isTabAware(value: unknown): value is TabAware {
  return (
    !!value &&
    typeof value === 'object' &&
    (typeof (value as TabAware).onTabActivated === 'function' ||
      typeof (value as TabAware).onTabDeactivated === 'function')
  );
}
