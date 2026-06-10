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
  id: string;                    // UUID único por instancia: "tab_inv_123_a8f2"
  type: TabType;                 // PINNED | MODULE_LIST | RECORD | WIZARD | REPORT | UTILITY

  // Presentación
  title: string;                 // "Factura #00123"
  icon: string;                  // "receipt" (Material Icon)
  badge?: number;                // Notificaciones dentro de la pestaña

  // Ruta asociada
  route: string;                 // "/invoices/123"
  routeParams: Record<string, string>;  // { id: '123' }
  queryParams?: Record<string, string>;

  // Estado
  isDirty: boolean;              // Cambios sin guardar
  isLoading: boolean;            // Cargando datos
  isCloseable: boolean;          // Si puede cerrarse
  isPinned: boolean;             // Si está fijada

  // Control de instancias
  entityKey?: string;            // "invoice:123" → evita duplicados de mismo registro

  // Ciclo de vida
  createdAt: Date;
  lastActivatedAt: Date;
  scrollPosition?: number;       // Preserva posición de scroll
  formState?: unknown;           // Estado del formulario si lo hay
}

export interface OpenTabConfig {
  route: string;
  routeParams?: Record<string, string>;
  queryParams?: Record<string, string>;
  title?: string;
  icon?: string;
}

export interface TabDefinition {
  pattern: string;
  component: any;
  tabType: TabType;
  title?: string;
  icon?: string;
  isCloseable?: boolean;
  entityKeyFn?: (params: Record<string, string>, data?: any) => string;
  titleFn?: (params: Record<string, string>, data?: any) => string;
}
