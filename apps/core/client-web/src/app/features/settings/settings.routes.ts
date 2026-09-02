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
                title: 'PAGE_TITLES.MY_PROFILE',
                loadComponent: () => import('./my-profile/my-profile.page').then(m => m.MyProfilePage)
            },
            {
                path: 'sessions',
                title: 'PAGE_TITLES.ACTIVE_SESSIONS',
                loadComponent: () => import('./pages/sessions/sessions.component').then(m => m.SessionsComponent)
            },
            // { path: 'notifications', ... } // Futuro

            // --- GRUPO 2: ORGANIZACIÓN (Global) ---
            // H-06 FIX: All company/financial/operational routes now require explicit permissions.
            // Defence-in-depth: backend still enforces authorisation; the guard prevents UI rendering
            // of components that would call APIs before receiving 403 (OWASP ASVS V4; CWE-284).
            {
                path: 'profile',
                title: 'PAGE_TITLES.COMPANY_PROFILE',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:view_company'] },
                loadComponent: () => import('./company-profile/company-profile.page').then(m => m.CompanyProfilePage)
            },
            {
                path: 'subsidiaries',
                title: 'PAGE_TITLES.COMPANY_STRUCTURE',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:view_company'] },
                loadComponent: () => import('./organization/subsidiaries/subsidiaries.page').then(m => m.SubsidiariesPage)
            },
            {
                path: 'branding',
                title: 'PAGE_TITLES.PERSONALIZATION',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] },
                loadComponent: () => import('./branding/branding.page').then(m => m.BrandingPage)
            },

            // --- GRUPO 3: FINANZAS (Reglas Contables) ---
            {
                path: 'accounting',
                title: 'PAGE_TITLES.ACCOUNTING_PREFERENCES',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:finance:view'] },
                loadComponent: () => import('./finance/accounting/accounting.page').then(m => m.AccountingSettingsPage)
            },
            {
                path: 'currencies',
                title: 'PAGE_TITLES.MULTICURRENCY',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:finance:view'] },
                loadComponent: () => import('./finance/currencies/currencies.page').then(m => m.CurrencySettingsPage)
            },
            {
                path: 'taxes',
                title: 'PAGE_TITLES.TAX_RULES',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:finance:view'] },
                loadComponent: () => import('./finance/taxes/taxes.page').then(m => m.TaxRulesPage)
            },
            {
                path: 'closing-rules',
                title: 'PAGE_TITLES.FISCAL_PERIODS',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:finance:view'] },
                loadComponent: () => import('./finance/closing-rules/closing-rules.page').then(m => m.ClosingRulesPage)
            },
            {
                path: 'intercompany',
                title: 'PAGE_TITLES.INTERCOMPANY_RULES',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:finance:view'] },
                loadComponent: () => import('./finance/intercompany/intercompany.page').then(m => m.IntercompanyPage)
            },
            {
                path: 'fiscal',
                title: 'PAGE_TITLES.EINVOICING',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] },
                loadComponent: () => import('./fiscal/fiscal.page').then(m => m.FiscalSettingsPage)
            },

            // --- GRUPO 4: OPERACIONES (Reglas de Proceso) ---
            {
                path: 'sequences',
                title: 'PAGE_TITLES.FISCAL_SEQUENCES',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] },
                loadComponent: () => import('./operations/sequences/sequences.page').then(m => m.SequenceSettingsPage)
            },
            {
                path: 'approvals',
                title: 'PAGE_TITLES.APPROVAL_WORKFLOWS',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] },
                loadComponent: () => import('./operations/approvals/approvals.page').then(m => m.ApprovalPoliciesPage)
            },
            {
                path: 'inventory-policies',
                title: 'PAGE_TITLES.INVENTORY_POLICIES',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] },
                loadComponent: () => import('./operations/inventory-policies/inventory-policies.page').then(m => m.InventoryPoliciesPage)
            },

            // --- GRUPO 5: SISTEMA (Técnico) ---
            {
                path: 'roles',
                title: 'PAGE_TITLES.ROLES_PERMISSIONS',
                loadComponent: () => import('./roles/roles.page').then(m => m.RolesManagementPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['roles:view'] }
            },
            {
                path: 'users',
                title: 'PAGE_TITLES.USER_MANAGEMENT',
                loadComponent: () => import('./user-management/user-management.page').then(m => m.UserManagementPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['users:view'] }
            },
            {
                path: 'security',
                title: 'PAGE_TITLES.SECURITY_AUDIT',
                loadComponent: () => import('./system/security/security.page').then(m => m.SecuritySettingsPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['users:view'] }
            },
            {
                path: 'integrations',
                title: 'PAGE_TITLES.INTEGRATIONS',
                loadComponent: () => import('./system/integrations/integrations.page').then(m => m.IntegrationSettingsPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] }
            },
            {
                path: 'smtp',
                title: 'PAGE_TITLES.MAIL_SERVER',
                loadComponent: () => import('./system/smtp/smtp.page').then(m => m.SmtpSettingsPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] }
            },
            {
                path: 'sso',
                title: 'PAGE_TITLES.SSO',
                loadComponent: () => import('./system/sso/sso.page').then(m => m.SsoSettingsPage),
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:edit_company'] }
            },
            // Legacy / Mapped
            {
                path: 'billing',
                title: 'PAGE_TITLES.BILLING_PLAN',
                canActivate: [permissionsGuard],
                data: { permissions: ['settings:view_company'] },
                loadComponent: () => import('./billing/billing.page').then(m => m.BillingPage)
            },
            { path: '', redirectTo: 'profile', pathMatch: 'full' }
        ]
    }
];
