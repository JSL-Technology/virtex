import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth';
import {
  ActiveOrganizationService,
  ORGANIZATION_SEGMENT,
  pathWithoutOrganization,
} from './active-organization.service';

/**
 * Asegura que toda ruta autenticada lleve una empresa a la que esta persona pertenece.
 *
 * Tres casos, y ninguno deja al usuario en una pantalla vacía:
 *
 * 1. **Sin prefijo** —un enlace viejo, un marcador de antes, la raíz—: redirige a la misma página
 *    dentro de la empresa del principal. Los enlaces existentes siguen funcionando, que es lo que
 *    permite desplegar esto sin romper lo que la gente tiene guardado.
 * 2. **Con una empresa a la que no pertenece** —o que no existe—: redirige a la suya. No se
 *    distingue «no existe» de «no tienes acceso», igual que en el servidor: la diferencia diría a
 *    cualquiera qué empresas hay en el producto.
 * 3. **Con una empresa correcta**: pasa.
 *
 * El guard NO es la autorización. La autorización la hace el servidor en cada petición
 * (`ActiveTenantGuard` comprueba la pertenencia contra `user_organizations`, y las políticas de
 * la base acotan las filas). Esto es navegación: evita que alguien se quede mirando una pantalla
 * que va a responder 403 a todo.
 */
export const organizationRouteGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const active = inject(ActiveOrganizationService);

  const user = auth.currentUser();
  // Sin principal no hay nada que decidir; `authGuard` ya se ocupa de eso y corre antes.
  if (!user) return true;

  const requested = state.url.split('/').filter(Boolean)[0] === ORGANIZATION_SEGMENT
    ? state.url.split('/').filter(Boolean)[1]
    : null;

  const available = user.organizations ?? [];
  //  Orden del respaldo: la última empresa usada en este navegador, luego la del principal, luego
  //  la primera a la que se tenga acceso. Lo primero es lo que hace que volver al producto te deje
  //  donde estabas en vez de en la empresa que el token traiga.
  const fallback = active.lastUsed() ?? user.organization?.slug ?? available[0]?.slug ?? null;

  if (requested && available.some((o) => o.slug === decodeURIComponent(requested))) {
    active.remember(decodeURIComponent(requested));
    return true;
  }

  if (!fallback) {
    // Un usuario autenticado sin ninguna empresa no puede usar el producto, y el servidor ya lo
    // rechaza. Se le lleva a la pantalla que lo explica en vez de a un armazón sin datos.
    return router.parseUrl('/unauthorized');
  }

  //  El fragmento se conserva. `pathWithoutOrganization` lo descarta a propósito —para las
  //  pestañas, el fragmento es estado de la ventana y no parte de la página—, pero aquí sí
  //  importa: el backend envía por correo enlaces como `/settings/my-profile`, que
  //  `settingsModalRedirectGuard` convierte en un fragmento, y perderlo dejaría a quien confirma
  //  su cambio de correo mirando el armazón sin la pantalla que venía a ver.
  const hash = state.url.indexOf('#');
  const fragment = hash >= 0 ? state.url.slice(hash) : '';
  const withoutOrg = pathWithoutOrganization(hash >= 0 ? state.url.slice(0, hash) : state.url);

  return router.parseUrl(`${active.urlFor(withoutOrg, fallback)}${fragment}`);
};
