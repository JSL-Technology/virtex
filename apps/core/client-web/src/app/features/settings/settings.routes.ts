import { Routes } from '@angular/router';
import { SettingsLayout } from './layout/settings.layout';
import { permissionsGuard } from '../../core/guards/permissions-guard';

export const SETTINGS_ROUTES: Routes = [
    {
        path: '',
        component: SettingsLayout,
        children: [
            // --- GRUPO 1: MI CUENTA (Personal) ---
            {
                path: 'my-profile',
                title: 'Mi Perfil',
                loadComponent: () => import('./my-profile/my-profile.page').then(m => m.MyProfilePage)
            },
            {
                path: 'sessions',
                title: 'Sesiones Activas',
                loadComponent: () => import('./pages/sessions/sessions.component').then(m => m.SessionsComponent)
            },
            // { path: 'notifications', ... } // Futuro

            // --- GRUPO 2: ORGANIZACIÓN (Global) ---
            {
                path: 'profile',
                title: 'Perfil de la Empresa',
                loadComponent: () => import('./company-profile/company-profile.page').then(m => m.CompanyProfilePage)
            },
            {
                path: 'subsidiaries',
                title: 'Estructura Empresarial',
                loadComponent: () => import('./organization/subsidiaries/subsidiaries.page').then(m => m.SubsidiariesPage)
            },
            {
                path: 'branding',
                title: 'Personalización',
                loadComponent: () => import('./branding/branding.page').then(m => m.BrandingPage)
            },

            // --- GRUPO 3: FINANZAS (Reglas Contables) ---
            {
                path: 'accounting',
                title: 'Preferencias Contables',
                loadComponent: () => import('./finance/accounting/accounting.page').then(m => m.AccountingSettingsPage)
            },
            {
                path: 'currencies',
                title: 'Multimoneda y Tasas',
                loadComponent: () => import('./finance/currencies/currencies.page').then(m => m.CurrencySettingsPage)
            },
            {
                path: 'taxes',
                title: 'Reglas de Impuestos',
                loadComponent: () => import('./finance/taxes/taxes.page').then(m => m.TaxRulesPage)
            },
            {
                path: 'closing-rules',
                title: 'Periodos y Cierre Fiscal',
                loadComponent: () => import('./finance/closing-rules/closing-rules.page').then(m => m.ClosingRulesPage)
            },
            {
                path: 'intercompany',
                title: 'Reglas Intercompany',
                loadComponent: () => import('./finance/intercompany/intercompany.page').then(m => m.IntercompanyPage)
            },

            // --- GRUPO 4: OPERACIONES (Reglas de Proceso) ---
            {
                path: 'sequences',
                title: 'Secuencias Fiscales',
                loadComponent: () => import('./operations/sequences/sequences.page').then(m => m.SequenceSettingsPage)
            },
            {
                path: 'approvals',
                title: 'Flujos de Aprobación',
                loadComponent: () => import('./operations/approvals/approvals.page').then(m => m.ApprovalPoliciesPage)
            },
            {
                path: 'inventory-policies',
                title: 'Políticas de Inventario',
                loadComponent: () => import('./operations/inventory-policies/inventory-policies.page').then(m => m.InventoryPoliciesPage)
            },

            // --- GRUPO 5: SISTEMA (Técnico) ---
            {
                path: 'roles',
                title: 'Roles y Permisos',
                loadComponent: () => import('./roles/roles.page').then(m => m.RolesManagementPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['roles:view'] }
            },
            {
                path: 'users',
                title: 'Gestión de Usuarios',
                loadComponent: () => import('./user-management/user-management.page').then(m => m.UserManagementPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['users:view'] }
            },
            {
                path: 'security',
                title: 'Seguridad y Auditoría',
                loadComponent: () => import('./system/security/security.page').then(m => m.SecuritySettingsPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['users:view'] }
            },
            {
                path: 'integrations',
                title: 'Integraciones (API)',
                loadComponent: () => import('./system/integrations/integrations.page').then(m => m.IntegrationSettingsPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] }
            },
            {
                path: 'smtp',
                title: 'Servidor de Correo',
                loadComponent: () => import('./system/smtp/smtp.page').then(m => m.SmtpSettingsPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] }
            },
            // Legacy / Mapped
            {
                path: 'billing',
                title: 'Facturación y Plan',
                loadComponent: () => import('./billing/billing.page').then(m => m.BillingPage)
            },
            { path: '', redirectTo: 'profile', pathMatch: 'full' }
        ]
    }
];
