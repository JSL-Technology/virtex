import { InjectionToken } from '@angular/core';
import { TabType } from './tab.model';

/**
 * Datos de la pestaña que hospeda al componente. Se provee por inyección a
 * través del injector del `ngComponentOutlet`, de modo que cualquier página
 * (genérica o real) pueda conocer su identidad sin acoplarse al @Input.
 */
export interface TabContext {
  tabId: string;
  type: TabType;
  route: string;
  title: string;
  icon: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

export const TAB_CONTEXT = new InjectionToken<TabContext>('TAB_CONTEXT');
