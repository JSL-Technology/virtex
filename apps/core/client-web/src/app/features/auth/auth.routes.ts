import { Routes } from '@angular/router';
// Importa el nuevo guard que acabamos de crear.
import { publicGuard } from '../../core/guards/public.guard';

/**
 * Alta (con prefijo de país, p. ej. `/es/do/auth/register`).
 *
 * Va dentro del armazón persistente `AuthShellComponent` para compartir lienzo,
 * lámina y pie con el resto de puertas de entrada. `data.authWidth: 'wide'` pide
 * la lámina ancha que necesita el asistente de dos columnas.
 */
export const REGISTER_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/auth-shell/auth-shell.component').then((m) => m.AuthShellComponent),
    children: [
      {
        path: 'register',
        title: 'AUTH.TITLES.REGISTER',
        canActivate: [publicGuard],
        data: { authWidth: 'wide' },
        loadComponent: () =>
          import('./register/register.page').then((m) => m.RegisterPage),
      },
      {
        path: '',
        redirectTo: 'register',
        pathMatch: 'full',
      },
    ],
  },
];
