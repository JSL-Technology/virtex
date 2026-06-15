import { Injectable, inject, Optional, Inject, Type } from '@angular/core';
import { TabDefinition, TabType } from './tab.model';
import { TAB_DEFINITIONS, CORE_TAB_DEFINITIONS } from './tab-definitions';
import { GenericModulePage } from './components/generic-module.page';
import { AuthService } from '../services/auth';

export interface ResolvedTab {
  definition: TabDefinition;
  params: Record<string, string>;
  /** true cuando se usó la definición genérica de relleno. */
  isFallback: boolean;
}

/**
 * Resuelve una ruta a su definición de pestaña. Reglas (TAB_ARCHITECTURE §5.3):
 *  1. Especificidad: literal gana a paramétrica del mismo nivel.
 *  2. Permisos: espejo del permissionsGuard (la autoridad sigue siendo el backend).
 *  3. Sin definición → se usa una definición genérica (sin clics muertos).
 */
@Injectable({ providedIn: 'root' })
export class TabRegistryService {
  private auth = inject(AuthService);

  private readonly registry: TabDefinition[];

  constructor(@Optional() @Inject(TAB_DEFINITIONS) provided?: TabDefinition[][]) {
    const fromProviders = (provided ?? []).flat();
    // Orden por especificidad (menos parámetros → más específico) y, a igualdad,
    // por longitud de patrón. Así /invoices/new vence a /invoices/:id.
    this.registry = [...CORE_TAB_DEFINITIONS, ...fromProviders].sort(
      (a, b) => this.specificity(b.pattern) - this.specificity(a.pattern)
    );
  }

  /** Devuelve la mejor definición para la ruta, o una genérica de relleno. */
  resolve(route: string): ResolvedTab {
    const routePath = this.normalize(route);

    const matches = this.registry
      .filter((def) => this.matches(def.pattern, routePath))
      .sort((a, b) => this.paramCount(a.pattern) - this.paramCount(b.pattern));

    const definition = matches[0];
    if (definition) {
      return {
        definition,
        params: this.getRouteParams(definition.pattern, routePath),
        isFallback: false,
      };
    }

    return {
      definition: this.buildGenericDefinition(routePath),
      params: {},
      isFallback: true,
    };
  }

  /** Compat: solo la definición (incluye fallback genérico). */
  getDefinitionByRoute(route: string): TabDefinition {
    return this.resolve(route).definition;
  }

  /** ¿El usuario puede abrir esta pestaña? (UX; backend sigue siendo autoridad). */
  canOpen(definition: TabDefinition): boolean {
    if (!definition.permissions?.length) return true;
    return this.auth.hasPermissions(definition.permissions);
  }

  getRouteParams(pattern: string, route: string): Record<string, string> {
    const params: Record<string, string> = {};
    const patternParts = this.segments(pattern);
    const routeParts = this.segments(this.normalize(route));
    patternParts.forEach((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(routeParts[i] ?? '');
      }
    });
    return params;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private buildGenericDefinition(routePath: string): TabDefinition {
    const title = this.prettify(routePath);
    return {
      pattern: routePath,
      tabType: TabType.MODULE_LIST,
      title,
      icon: 'LayoutGrid',
      isCloseable: true,
      entityKeyFn: () => `module:${routePath}`,
      load: () => Promise.resolve(GenericModulePage as unknown as Type<unknown>),
    };
  }

  private matches(pattern: string, routePath: string): boolean {
    const patternParts = this.segments(pattern);
    const routeParts = this.segments(routePath);
    if (patternParts.length !== routeParts.length) return false;
    return patternParts.every(
      (part, i) => part.startsWith(':') || part === routeParts[i]
    );
  }

  private specificity(pattern: string): number {
    const parts = this.segments(pattern);
    // literal = 2, param = 1; suma + factor por profundidad.
    return parts.reduce((acc, p) => acc + (p.startsWith(':') ? 1 : 2), 0) * 10 + parts.length;
  }

  private paramCount(pattern: string): number {
    return this.segments(pattern).filter((p) => p.startsWith(':')).length;
  }

  private segments(path: string): string[] {
    return path.split('/').filter((p) => p.length > 0);
  }

  private normalize(route: string): string {
    const path = route.split('?')[0].split('#')[0];
    return '/' + this.segments(path).join('/');
  }

  private prettify(routePath: string): string {
    const last = this.segments(routePath).pop() ?? 'Módulo';
    return last.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
