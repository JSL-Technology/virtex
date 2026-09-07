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
import { isLanguageCode } from '@virteex/shared/types';
import { buildModuleRoutes } from './core/modules/module-registry';

// Only match 2-letter country codes so route segments like 'login' or 'auth' never bleed into :country
export function countryCodeMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length > 0 && /^[a-zA-Z]{2}$/.test(segments[0].path)) {
    return { consumed: [segments[0]], posParams: { country: segments[0] } };
  }
  return null;
}

// Only match the first segment when it is a SUPPORTED language code (es/en).
// This is critical: the authenticated shell below is a `path: ''` route whose `**`
// child swallows any URL, so the public language routes must (a) come before it AND
// (b) match ONLY real language prefixes — otherwise clean authenticated URLs like
// `/dashboard` would be captured here as `:lang`, and (worse) the unauthenticated
// redirect target `/{lang}/auth/login` would fall into the shell's `**`, whose
// authGuard would redirect to `/{lang}/auth/login` again → infinite redirect loop.
export function langCodeMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length > 0 && isLanguageCode(segments[0].path.toLowerCase())) {
    return { consumed: [segments[0]], posParams: { lang: segments[0] } };
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
    title: 'AUTH.TITLES.CHECKOUT',
    loadComponent: () =>
      import('./features/auth/checkout-complete/checkout-complete.page').then(
        (m) => m.CheckoutCompletePage
      ),
  },

  // 2. Payment Routes (public, no :lang prefix). Declared before the authenticated
  // shell so its `**` child never captures them.
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

  // 3. Public language-prefixed routes (e.g. /es/auth/login).
  // MUST come before the authenticated `path: ''` shell below — see langCodeMatcher.
  {
    matcher: langCodeMatcher,
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
      // H11 FIX: Added canActivateChild: [publicGuard] so authenticated users are redirected
      // away from auth pages regardless of which sub-path they land on.
      {
        path: 'auth',
        canActivateChild: [publicGuard],
        children: [
            // Pantallas que conservan su propio armazón (no comparten la lámina
            // persistente): la confirmación de pago y la selección de plan.
            {
                path: 'checkout-complete',
                title: 'AUTH.TITLES.CHECKOUT',
                loadComponent: () =>
                import('./features/auth/checkout-complete/checkout-complete.page').then(
                    (m) => m.CheckoutCompletePage
                ),
            },
            {
                path: 'plan-selection',
                title: 'AUTH.TITLES.PLAN',
                loadComponent: () =>
                import('./features/payment/components/plan-selection/plan-selection.component').then(
                    (m) => m.PlanSelectionComponent
                ),
            },
            // Armazón persistente: acceso, recuperación y restablecimiento
            // comparten lienzo y lámina; al navegar solo cambia el contenido
            // interior, con una transición suave.
            {
                path: '',
                loadComponent: () =>
                import('./features/auth/components/auth-shell/auth-shell.component').then(
                    (m) => m.AuthShellComponent
                ),
                children: [
                    {
                        path: 'login',
                        title: 'AUTH.TITLES.LOGIN',
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
                        title: 'AUTH.TITLES.SET_PASSWORD',
                        loadComponent: () =>
                        import('./features/auth/set-password/set-password.page').then((m) => m.SetPasswordPage),
                    },
                    {
                        path: '',
                        pathMatch: 'full',
                        redirectTo: 'login',
                    },
                ],
            },
        ]
      },
    ]
  },

  // 4. Authenticated routes, generated from the module manifests.
  //
  // This block used to list roughly ninety routes by hand while `tab-definitions.ts` listed 15
  // windows and `sidebar-menu.ts` listed 50 links, with nothing keeping the three in step. The
  // result was not cosmetic: 40 of those links opened an "under construction" card over pages that
  // were built and wired to working endpoints.
  //
  // Now there is one declaration — the manifest — and both the router and the window host read it.
  // Adding a page is adding a route to its module; the menu entry and the window follow, because
  // they are derived rather than repeated.
  {
    path: '',
    component: MainLayout,
    canActivate: [authGuard],
    children: [
      ...buildModuleRoutes().map((route) => ({
        ...route,
        canActivate: [permissionsGuard],
      })),
      // Direct navigation to /settings/* is intercepted and reopened in the modal outlet.
      {
        path: 'settings',
        canActivate: [settingsModalRedirectGuard],
        component: RouteRedirectorComponent,
        children: [{ path: '**', component: RouteRedirectorComponent }],
      },
      // Workspace catch-all: any authenticated route without a page of its own matches here so the
      // Router↔Workspace bridge opens its tab (Dockview paints the content, not a router-outlet).
      // MUST stay the last child of MainLayout.
      {
        path: '**',
        loadComponent: () =>
          import('./core/components/workspace-blank/workspace-blank').then(
            (m) => m.WorkspaceBlankComponent
          ),
      }
    ]
  },

  // 5. Fallback
  {
    path: '**',
    canActivate: [languageRedirectGuard],
    component: RouteRedirectorComponent,
  },
];
