import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

export const APP_ROUTES: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/terminal/terminal.component').then(
        (m) => m.TerminalComponent,
      ),
  },
  { path: '**', redirectTo: '' },
];
