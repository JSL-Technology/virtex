import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const APP_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/terminal/terminal.component').then((m) => m.TerminalComponent),
  },
  { path: '**', redirectTo: '' },
];
