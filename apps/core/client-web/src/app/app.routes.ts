import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';
import { MainLayout } from './layout/main/main.layout';
import { RouteRedirectorComponent } from './core/components/route-redirector/route-redirector';
import { languageInitGuard } from './core/guards/language-init.guard';
import { languageRedirectGuard } from './core/guards/language-redirect.guard';
import { CountryGuard } from './core/guards/country.guard';

export const APP_ROUTES: Routes = [
  // 1. Root Redirector: Handles '/' specifically
  {
    path: '',
    pathMatch: 'full',
    component: RouteRedirectorComponent,
    canActivate: [languageRedirectGuard]
  },

  // 2. Authenticated Routes (Clean URLs) - e.g. /dashboard
  {
    path: '',
    component: MainLayout,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        title: 'Dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then(
            (m) => m.DashboardPage
          ),
      },
      // ... other authenticated routes (copied from original file to maintain completeness)
      {
        path: 'my-work',
        title: 'My Work',
        loadComponent: () =>
          import('./features/my-work/my-work.page').then((m) => m.MyWorkPage),
      },
      {
        path: 'approvals',
        title: 'Approvals',
        loadComponent: () =>
          import('./features/approvals/approvals.page').then(
            (m) => m.ApprovalsPage
          ),
      },
      {
        path: 'notifications',
        title: 'Notifications',
        loadComponent: () =>
          import('./features/notifications/notifications.page').then(
            (m) => m.NotificationsPage
          ),
      },
      {
        path: 'global-search',
        title: 'Búsqueda',
        loadComponent: () =>
          import('./features/global-search/global-search.page').then(
            (m) => m.GlobalSearchPage
          ),
      },
      {
        path: 'data-imports',
        title: 'Data Imports',
        loadComponent: () =>
          import('./features/data-imports/data-imports.page').then(
            (m) => m.DataImportsPage
          ),
      },
      {
        path: 'data-exports',
        title: 'Data Exports',
        loadComponent: () =>
          import('./features/data-exports/data-exports.page').then(
            (m) => m.DataExportsPage
          ),
      },
      {
        path: 'masters',
        title: 'Master Data',
        loadChildren: () =>
          import('./features/masters/masters.routes').then(
            (m) => m.MASTERS_ROUTES
          ),
      },
      {
        path: 'documents',
        title: 'Documents',
        loadComponent: () =>
          import('./features/documents/layout/documents.layout').then(
            (m) => m.DocumentsLayout
          ),
      },
      {
        path: 'sales',
        title: 'Ventas',
        loadChildren: () =>
          import('./features/sales/sales.routes').then((m) => m.SALES_ROUTES),
      },
      {
        path: 'invoices',
        title: 'Facturas',
        loadChildren: () =>
          import('./features/invoices/invoices.routes').then(
            (m) => m.INVOICES_ROUTES
          ),
      },
      {
        path: 'inventory',
        title: 'Inventario',
        loadChildren: () =>
          import('./features/inventory/inventory.routes').then(
            (m) => m.INVENTORY_ROUTES
          ),
      },
      {
        path: 'manufacturing',
        title: 'Manufacturing (MRP)',
        loadChildren: () =>
          import('./features/manufacturing/manufacturing.routes').then(
            (m) => m.MANUFACTURING_ROUTES
          ),
      },
      {
        path: 'wms',
        title: 'Warehouse Management (WMS)',
        loadChildren: () =>
          import('./features/wms/wms.routes').then(
            (m) => m.WMS_ROUTES
          ),
      },
      {
        path: 'projects',
        title: 'Projects (PSA)',
        loadChildren: () =>
          import('./features/projects/projects.routes').then(
            (m) => m.PROJECTS_ROUTES
          ),
      },
      {
        path: 'hcm',
        title: 'Human Resources (HCM)',
        loadChildren: () =>
          import('./features/hcm/hcm.routes').then(
            (m) => m.HCM_ROUTES
          ),
      },
      {
        path: 'procurement',
        title: 'Procurement & Suppliers',
        loadChildren: () =>
          import('./features/procurement/procurement.routes').then(
            (m) => m.PROCUREMENT_ROUTES
          ),
      },
      {
        path: 'documents',
        loadChildren: () =>
          import('./features/documents/documents.routes').then(
            (m) => m.DOCUMENTS_ROUTES
          ),
      },
      {
        path: 'contacts',
        title: 'Contactos',
        loadChildren: () =>
          import('./features/contacts/contacts.routes').then(
            (m) => m.CONTACTS_ROUTES
          ),
      },
      {
        path: 'accounting',
        title: 'Accounting',
        loadChildren: () =>
          import('./features/accounting/accounting.routes').then(
            (m) => m.ACCOUNTING_ROUTES
          ),
      },
      {
        path: 'settings',
        title: 'Configuración',
        loadChildren: () =>
          import('./features/settings/settings.routes').then(
            (m) => m.SETTINGS_ROUTES
          ),
      },
      {
        path: 'reports',
        title: 'Reports',
        loadChildren: () =>
          import('./features/reports/reports.routes').then(
            (m) => m.REPORTS_ROUTES
          ),
      },
      {
        path: 'purchasing',
        title: 'Purchasing',
        loadChildren: () =>
          import('./features/purchasing/purchasing.routes').then(
            (m) => m.PURCHASING_ROUTES
          ),
      },
      {
        path: 'accounts-payable',
        title: 'Cuentas por Pagar',
        loadChildren: () =>
          import('./features/accounts-payable/accounts-payable.routes').then(
            (m) => m.ACCOUNTS_PAYABLE_ROUTES
          ),
      },
      {
        path: 'customer-receipts',
        title: 'Recibos de Cliente',
        loadChildren: () =>
          import('./features/customer-receipts/customer-receipts.routes').then(
            (m) => m.CUSTOMER_RECEIPTS_ROUTES
          ),
      },
      {
        path: 'unauthorized',
        title: 'Acceso Denegado',
        loadComponent: () =>
          import('./features/unauthorized/unauthorized.page').then(
            (m) => m.UnauthorizedPage
          ),
      }
    ]
  },

  // 3. Payment Routes
  {
    path: 'payment',
    children: [
      {
        path: 'success',
        loadComponent: () => import('./features/payment/components/payment-success/payment-success.component').then(m => m.PaymentSuccessComponent)
      },
      {
        path: 'cancel',
        loadComponent: () => import('./features/payment/components/payment-cancel/payment-cancel.component').then(m => m.PaymentCancelComponent)
      }
    ]
  },

  // 4. Public Routes
  {
    path: ':lang',
    canActivate: [languageInitGuard],
    children: [
      // Country-specific public routes (e.g., /es/do/auth/register)
      {
        path: ':country',
        canActivate: [CountryGuard],
        children: [
          {
            path: 'auth',
            loadChildren: () => import('./features/auth/auth.routes').then((m) => m.REGISTER_ROUTES),
          }
        ]
      },
      // Generic language-only routes (e.g., /es/auth/login)
      // Note: If a route matches :country, it will go there first.
      // 'auth' is not a country code, so /es/auth/login will fall through to here?
      // No, 'auth' would match ':country' if we are not careful.
      // We need to distinguish between country codes (2 letters) and 'auth'.
      // However, usually country codes are 2 letters. 'auth' is 4.
      // We can rely on router matching order OR regex matchers (available in newer Angular).
      // Or we can be explicit.

      // Let's explicitly put 'auth' FIRST to capture /es/auth/...
      {
        path: 'auth',
        children: [
            {
                path: 'login',
                title: 'Iniciar Sesión | FacturaPRO',
                loadComponent: () => import('./features/auth/login/login.page').then((m) => m.LoginPage),
            },
             {
                path: 'forgot-password',
                loadComponent: () =>
                import('./features/auth/forgot-password/forgot-password/forgot-password.page').then(
                    (m) => m.ForgotPasswordPage
                ),
            },
            {
                path: 'reset-password',
                loadComponent: () =>
                import('./features/auth/reset-password/reset-password.page/reset-password.page').then(
                    (m) => m.ResetPasswordPage
                ),
            },
            {
                path: 'set-password',
                title: 'Configurar Contraseña',
                loadComponent: () =>
                import('./features/auth/set-password/set-password.page').then((m) => m.SetPasswordPage),
            },
             {
                path: '',
                loadChildren: () =>
                import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
            },
        ]
      },
      // Then catch other 2-letter segments as country?
      // Or just let it be. 'register' is inside 'auth'.
      // If we go to /es/do/auth/register:
      // :lang = es
      // :country = do -> matches ':country' path? Yes.
      // children -> auth -> register.

      // If we go to /es/auth/login:
      // :lang = es
      // matches 'auth' path directly? YES. Angular matches static paths before parameterized paths if they are siblings.
      // So 'auth' will take precedence over ':country'.
      // This is good.
    ]
  },

  // 5. Fallback
  {
    path: '**',
    canActivate: [languageRedirectGuard],
    component: RouteRedirectorComponent,
  },
];
