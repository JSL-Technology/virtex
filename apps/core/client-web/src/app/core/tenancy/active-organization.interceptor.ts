import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { ActiveOrganizationService } from './active-organization.service';

/** La cabecera que el servidor lee para saber en qué empresa actúa la petición. */
export const ACTIVE_ORGANIZATION_HEADER = 'X-Virtex-Organization';

/**
 * Manda la empresa de ESTA ventana en cada llamada a la API.
 *
 * Es la mitad cliente de la decisión: la empresa activa ya no es una propiedad de la sesión —que
 * comparten todas las pestañas— sino de la ventana, y la ventana la declara en cada petición. Dos
 * pestañas en dos empresas distintas son dos cabeceras distintas sobre la misma sesión.
 *
 * Solo se añade a las llamadas a la propia API: una petición a un tercero no tiene por qué saber
 * en qué empresa está trabajando quien la origina. Y solo cuando la URL trae una empresa, de modo
 * que las pantallas públicas —iniciar sesión, el alta, el retorno del pago— salen exactamente
 * igual que antes.
 *
 * Que la cabecera la ponga el cliente no la hace confiable, y el servidor no la trata como tal:
 * `ActiveTenantGuard` resuelve el slug y comprueba la pertenencia en cada petición. Esto es
 * conveniencia; la autorización está al otro lado.
 */
export const activeOrganizationInterceptor: HttpInterceptorFn = (request, next) => {
  const isOwnApi = request.url.startsWith('/api/') || request.url.includes('/api/v1/');
  if (!isOwnApi) return next(request);

  const slug = inject(ActiveOrganizationService).slug();
  if (!slug) return next(request);

  return next(request.clone({ setHeaders: { [ACTIVE_ORGANIZATION_HEADER]: slug } }));
};
