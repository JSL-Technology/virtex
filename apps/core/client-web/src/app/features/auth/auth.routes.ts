import { Routes } from '@angular/router';
// Importa el nuevo guard que acabamos de crear.
import { publicGuard } from '../../core/guards/public.guard';

export const REGISTER_ROUTES: Routes = [
  {
    path: 'register',
    title: 'AUTH.TITLES.REGISTER',
    // Aplica el guard a esta ruta.
    canActivate: [publicGuard],
    loadComponent: () =>
      import('./register/register.page').then((m) => m.RegisterPage),
  },
  {
    path: '',
    redirectTo: 'register',
    pathMatch: 'full',
  },
];

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    title: 'AUTH.TITLES.LOGIN',
    // Aplica el guard a esta ruta.
    canActivate: [publicGuard],
    loadComponent: () => import('./login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'forgot-password',
    // Aplica el guard a esta ruta.
    canActivate: [publicGuard],
    loadComponent: () =>
      import('./forgot-password/forgot-password/forgot-password.page').then(
        (m) => m.ForgotPasswordPage
      ),
  },
  {
    path: 'reset-password',
    // Aplica el guard a esta ruta.
    canActivate: [publicGuard],
    loadComponent: () =>
      import('./reset-password/reset-password.page/reset-password.page').then(
        (m) => m.ResetPasswordPage
      ),
  },
  {
    path: 'set-password',
    title: 'AUTH.TITLES.SET_PASSWORD',
    loadComponent: () =>
      import('./set-password/set-password.page').then((m) => m.SetPasswordPage),
  },
  {
    path: 'checkout-complete',
    title: 'AUTH.TITLES.CHECKOUT',
    loadComponent: () =>
      import('./checkout-complete/checkout-complete.page').then((m) => m.CheckoutCompletePage),
  },
  {
    path: 'plan-selection',
    title: 'AUTH.TITLES.PLAN',
    loadComponent: () => import('../payment/components/plan-selection/plan-selection.component').then(m => m.PlanSelectionComponent)
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];
