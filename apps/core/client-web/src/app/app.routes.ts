import { Routes, UrlSegment, UrlMatchResult } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';
import { publicGuard } from './core/guards/public.guard';
import { permissionsGuard } from './core/guards/permissions-guard';
import { settingsModalRedirectGuard } from './core/guards/settings-modal-redirect.guard';
import { MainLayout } from './layout/main/main.layout';
import { RouteRedirectorComponent } from './core/components/route-redirector/route-redirector';
import { languageInitGuard } from './core/guards/language-init.guard';
import { languageRedirectGuard } from './core/guards/language-redirect.guard';
import { CountryGuard } from './core/guards/country.guard';

// Only match 2-letter country codes so route segments like 'login' or 'auth' never bleed into :country
export function countryCodeMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length > 0 && /^[a-zA-Z]{2}$/.test(segments[0].path)) {
    return { consumed: [segments[0]], posParams: { country: segments[0] } };
  }
  return null;
}

export const APP_ROUTES: Routes = [
  // 1. Root Redirector: Handles '/' specifically
  {
    path: '',
    pathMatch: 'full',
    component: RouteRedirectorComponent,
    canActivate: [languageRedirectGuard]
  },

  // 1b. Post-checkout landing (clean URL, NO :lang prefix).
  // Stripe redirects here after a signup payment with ?session_id=... The backend
  // builds this success_url server-side from FRONTEND_URL, so it cannot know the
  // user's language. Keeping it at the root (like /payment/*) guarantees the route
  // matches and the session_id survives — otherwise the :lang route captures "auth",
  // the rest fails to match, and the ** fallback redirects to /login, dropping the
  // session_id so the account is never confirmed/created.
  {
    path: 'auth/checkout-complete',
    title: 'Confirmando pago | FacturaPRO',
    loadComponent: () =>
      import('./features/auth/checkout-complete/checkout-complete.page').then(
        (m) => m.CheckoutCompletePage
      ),
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
      // H-12 FIX: Add permissionsGuard to module routes so the UI reflects the same RBAC
      // enforced by the backend. The backend remains the authoritative source of truth;
      // client guards prevent confusing UX and unnecessary API calls for unauthorised users
      // (OWASP ASVS 4.1.1; OWASP Top 10 A01 Broken Access Control).
      {
        path: 'sales',
        title: 'Ventas',
        canActivate: [permissionsGuard],
        data: { permissions: ['sales:view'] },
        loadChildren: () =>
          import('./features/sales/sales.routes').then((m) => m.SALES_ROUTES),
      },
      {
        path: 'invoices',
        title: 'Facturas',
        canActivate: [permissionsGuard],
        data: { permissions: ['invoices:view'] },
        loadChildren: () =>
          import('./features/invoices/invoices.routes').then(
            (m) => m.INVOICES_ROUTES
          ),
      },
      {
        path: 'inventory',
        title: 'Inventario',
        canActivate: [permissionsGuard],
        data: { permissions: ['inventory:view'] },
        loadChildren: () =>
          import('./features/inventory/inventory.routes').then(
            (m) => m.INVENTORY_ROUTES
          ),
      },
      {
        path: 'manufacturing',
        title: 'Manufacturing (MRP)',
        canActivate: [permissionsGuard],
        data: { permissions: ['manufacturing:view'] },
        loadChildren: () =>
          import('./features/manufacturing/manufacturing.routes').then(
            (m) => m.MANUFACTURING_ROUTES
          ),
      },
      {
        path: 'wms',
        title: 'Warehouse Management (WMS)',
        canActivate: [permissionsGuard],
        data: { permissions: ['wms:view'] },
        loadChildren: () =>
          import('./features/wms/wms.routes').then(
            (m) => m.WMS_ROUTES
          ),
      },
      {
        path: 'projects',
        title: 'Projects (PSA)',
        canActivate: [permissionsGuard],
        data: { permissions: ['projects:view'] },
        loadChildren: () =>
          import('./features/projects/projects.routes').then(
            (m) => m.PROJECTS_ROUTES
          ),
      },
      {
        path: 'hcm',
        title: 'Human Resources (HCM)',
        canActivate: [permissionsGuard],
        data: { permissions: ['hcm:view'] },
        loadChildren: () =>
          import('./features/hcm/hcm.routes').then(
            (m) => m.HCM_ROUTES
          ),
      },
      {
        path: 'procurement',
        title: 'Procurement & Suppliers',
        canActivate: [permissionsGuard],
        data: { permissions: ['procurement:view'] },
        loadChildren: () =>
          import('./features/procurement/procurement.routes').then(
            (m) => m.PROCUREMENT_ROUTES
          ),
      },
      {
        path: 'documents',
        canActivate: [permissionsGuard],
        data: { permissions: ['documents:view'] },
        loadChildren: () =>
          import('./features/documents/documents.routes').then(
            (m) => m.DOCUMENTS_ROUTES
          ),
      },
      {
        path: 'contacts',
        title: 'Contactos',
        canActivate: [permissionsGuard],
        data: { permissions: ['contacts:view'] },
        loadChildren: () =>
          import('./features/contacts/contacts.routes').then(
            (m) => m.CONTACTS_ROUTES
          ),
      },
      {
        path: 'accounting',
        title: 'Accounting',
        canActivate: [permissionsGuard],
        data: { permissions: ['accounting:view'] },
        loadChildren: () =>
          import('./features/accounting/accounting.routes').then(
            (m) => m.ACCOUNTING_ROUTES
          ),
      },
      // Direct navigation to /settings/* is intercepted and reopened in the modal outlet.
      {
        path: 'settings',
        canActivate: [settingsModalRedirectGuard],
        component: RouteRedirectorComponent,
        children: [{ path: '**', component: RouteRedirectorComponent }],
      },
      {
        path: 'reports',
        title: 'Reports',
        canActivate: [permissionsGuard],
        data: { permissions: ['reports:view'] },
        loadChildren: () =>
          import('./features/reports/reports.routes').then(
            (m) => m.REPORTS_ROUTES
          ),
      },
      {
        path: 'datasheets',
        title: 'DataSheets',
        canActivate: [permissionsGuard],
        data: { permissions: ['reports:view'] },
        loadChildren: () =>
          import('./features/datasheets/datasheets.routes').then(
            (m) => m.DATASHEET_ROUTES
          ),
      },
      {
        path: 'purchasing',
        title: 'Purchasing',
        canActivate: [permissionsGuard],
        data: { permissions: ['purchasing:view'] },
        loadChildren: () =>
          import('./features/purchasing/purchasing.routes').then(
            (m) => m.PURCHASING_ROUTES
          ),
      },
      {
        path: 'accounts-payable',
        title: 'Cuentas por Pagar',
        canActivate: [permissionsGuard],
        data: { permissions: ['accounting:view'] },
        loadChildren: () =>
          import('./features/accounts-payable/accounts-payable.routes').then(
            (m) => m.ACCOUNTS_PAYABLE_ROUTES
          ),
      },
      {
        path: 'customer-receipts',
        title: 'Recibos de Cliente',
        canActivate: [permissionsGuard],
        data: { permissions: ['sales:view'] },
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
      // matcher ensures only 2-letter codes match — prevents 'login', 'auth', etc. from being treated as a country
      {
        matcher: countryCodeMatcher,
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

      // H11 FIX: Added canActivateChild: [publicGuard] so authenticated users are redirected
      // away from auth pages regardless of which sub-path they land on.
      {
        path: 'auth',
        canActivateChild: [publicGuard],
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
