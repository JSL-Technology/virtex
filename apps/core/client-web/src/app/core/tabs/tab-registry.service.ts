import { Injectable } from '@angular/core';
import { TabDefinition, TabType } from './tab.model';
import { DashboardPage } from '../../features/dashboard/dashboard.page';
import { HistoryPage as SalesHistoryPage } from '../../features/sales/history/history.page';
import { InvoicesListPage } from '../../features/invoices/list/list.page';
import { NewInvoicePage } from '../../features/invoices/new/new.page';
import { InvoiceDetailPage } from '../../features/invoices/detail/detail.page';
import { ProductsPage } from '../../features/inventory/products/products.page';
import { CustomersPage } from '../../features/contacts/customers/customers.page';
import { MyWorkPage } from '../../features/my-work/my-work.page';
import { ApprovalsPage } from '../../features/approvals/approvals.page';
import { NotificationsPage } from '../../features/notifications/notifications.page';
import { GlobalSearchPage } from '../../features/global-search/global-search.page';

@Injectable({
  providedIn: 'root',
})
export class TabRegistryService {
  private readonly registry: TabDefinition[] = [
    {
      pattern: '/dashboard',
      component: DashboardPage,
      tabType: TabType.PINNED,
      title: 'Dashboard',
      icon: 'LayoutDashboard',
      isCloseable: false,
    },
    {
      pattern: '/my-work',
      component: MyWorkPage,
      tabType: TabType.UTILITY,
      title: 'Mi trabajo',
      icon: 'ClipboardList',
    },
    {
      pattern: '/approvals',
      component: ApprovalsPage,
      tabType: TabType.UTILITY,
      title: 'Aprobaciones',
      icon: 'CheckSquare',
    },
    {
      pattern: '/notifications',
      component: NotificationsPage,
      tabType: TabType.UTILITY,
      title: 'Notificaciones',
      icon: 'Bell',
    },
    {
      pattern: '/global-search',
      component: GlobalSearchPage,
      tabType: TabType.UTILITY,
      title: 'Búsqueda global',
      icon: 'Search',
    },
    {
      pattern: '/sales',
      component: SalesHistoryPage,
      tabType: TabType.MODULE_LIST,
      entityKeyFn: () => 'module:sales',
      title: 'Ventas',
      icon: 'ShoppingCart',
    },
    {
      pattern: '/invoices',
      component: InvoicesListPage,
      tabType: TabType.MODULE_LIST,
      entityKeyFn: () => 'module:invoices',
      title: 'Facturas',
      icon: 'Receipt',
    },
    {
      pattern: '/invoices/new',
      component: NewInvoicePage,
      tabType: TabType.WIZARD,
      entityKeyFn: () => `invoice:new:${Date.now()}`,
      title: 'Nueva Factura',
      icon: 'PlusCircle',
    },
    {
      pattern: '/invoices/:id',
      component: InvoiceDetailPage,
      tabType: TabType.RECORD,
      entityKeyFn: (params) => `invoice:${params['id']}`,
      titleFn: (params, data) => `Factura #${data?.number || params['id']}`,
      icon: 'FileText',
    },
    {
      pattern: '/inventory',
      component: ProductsPage,
      tabType: TabType.MODULE_LIST,
      entityKeyFn: () => 'module:inventory',
      title: 'Inventario',
      icon: 'Package',
    },
    {
      pattern: '/contacts',
      component: CustomersPage,
      tabType: TabType.MODULE_LIST,
      entityKeyFn: () => 'module:contacts',
      title: 'Contactos',
      icon: 'Users',
    }
  ];

  getDefinitionByRoute(route: string): TabDefinition | null {
    const routePath = route.split('?')[0].split('#')[0];
    return this.registry.find(def => {
      const patternParts = def.pattern.split('/').filter(p => p);
      const routeParts = routePath.split('/').filter(p => p);

      if (patternParts.length !== routeParts.length) return false;

      return patternParts.every((part, i) => {
        return part.startsWith(':') || part === routeParts[i];
      });
    }) || null;
  }

  getRouteParams(pattern: string, route: string): Record<string, string> {
    const params: Record<string, string> = {};
    const routePath = route.split('?')[0].split('#')[0];
    const patternParts = pattern.split('/').filter(p => p);
    const routeParts = routePath.split('/').filter(p => p);

    patternParts.forEach((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = routeParts[i];
      }
    });

    return params;
  }
}
