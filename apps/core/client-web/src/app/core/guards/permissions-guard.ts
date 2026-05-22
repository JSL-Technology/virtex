import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

export const permissionsGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const requiredPermissions = route.data['permissions'] as string[] | undefined;

  // Si la ruta no define permisos, se permite el acceso.
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }

  // Comprueba si el usuario tiene TODOS los permisos requeridos.
  const hasPermissions = authService.hasPermissions(requiredPermissions);

  if (hasPermissions) {
    return true;
  } else {
    // Si no tiene permisos, redirige al dashboard.
    // console.warn(
    //   `Acceso denegado a la ruta ${
    //     state.url
    //   }. Permisos requeridos: ${requiredPermissions.join(', ')}`
    // );
    return router.createUrlTree(['/unauthorized'], {
      queryParams: { url: state.url },
    });
  }
};
