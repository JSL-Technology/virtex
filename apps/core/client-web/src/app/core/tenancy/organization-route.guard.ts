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

  //  La empresa del principal cuenta siempre como accesible, aunque la lista `organizations`
  //  llegue vacía (un bootstrap de sesión antiguo, una caché a medio poblar): el principal ES la
  //  prueba de pertenencia a esa empresa, el servidor la emitió.
  const available = mergeOrganizations(user.organizations ?? [], user.organization);
  const isAvailable = (slug: string | null | undefined): slug is string =>
    !!slug && available.some((o) => o.slug === slug);

  const requestedSlug = requested ? safeDecode(requested) : null;
  if (requestedSlug && isAvailable(requestedSlug)) {
    active.remember(requestedSlug);
    return true;
  }

  //  Orden del respaldo: la última empresa usada en este navegador, luego la del principal, luego
  //  la primera a la que se tenga acceso. Lo primero es lo que hace que volver al producto te deje
  //  donde estabas en vez de en la empresa que el token traiga.
  //
  //  Cada candidata se valida contra `available`. Antes `lastUsed()` se aceptaba a ciegas: si la
  //  empresa recordada no estaba en la lista (porque la lista llegó vacía o porque el usuario ya
  //  no pertenece), el guard redirigía a LA MISMA URL que acababa de rechazar, y el router entraba
  //  en un bucle infinito que congelaba la pestaña (QA C-02).
  const fallback =
    [active.lastUsed(), user.organization?.slug, available[0]?.slug].find(isAvailable) ?? null;

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
  const target = `${active.urlFor(withoutOrg, fallback)}${fragment}`;

  //  Cinturón de seguridad contra bucles: un guard que devuelve la URL que está evaluando obliga
  //  al router a re-evaluarla sin fin. Con la validación de arriba no debería ocurrir, pero el
  //  coste de equivocarse es una pestaña congelada, así que se corta explícitamente.
  if (target === state.url) {
    return router.parseUrl('/unauthorized');
  }

  return router.parseUrl(target);
};

type OrganizationRef = { slug?: string | null };

function mergeOrganizations<T extends OrganizationRef>(
  list: ReadonlyArray<T>,
  principal: T | null | undefined,
): T[] {
  const merged = [...list];
  if (principal?.slug && !merged.some((o) => o.slug === principal.slug)) merged.unshift(principal);
  return merged.filter((o) => !!o.slug);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
