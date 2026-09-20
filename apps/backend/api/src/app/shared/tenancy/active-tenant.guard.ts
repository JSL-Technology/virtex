import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';

import { AuthenticatedUser } from '../../security/principal';
import { ForbiddenError } from '../../i18n/localized.exception';
import { isOrganizationSlug } from './organization-slug';
import { OrganizationLookupPort, PrincipalResolverPort } from './ports/active-tenant.ports';

/**
 * ¿Es este error «no perteneces a esa empresa» y no otra cosa?
 *
 * Se mira el código estable y no el mensaje: el mensaje está localizado y cambia de idioma.
 */
function isMembershipDenial(error: unknown): boolean {
  const response = (error as { response?: unknown })?.response;
  const code =
    typeof response === 'object' && response !== null
      ? (response as { code?: unknown; message?: unknown }).code ??
        (response as { message?: unknown }).message
      : response;
  return code === 'AUTH_INVALID_CREDENTIALS';
}

/** La cabecera con la que el cliente dice en qué empresa actúa esta petición. */
export const ACTIVE_ORGANIZATION_HEADER = 'x-virtex-organization';

/**
 * La petición, tipada con el principal de la APLICACIÓN.
 *
 * No se usa `AuthenticatedRequest` de `@virteex/shared/util-auth` porque su `user.roles` es
 * `string[]` mientras el principal que construye `UserIdentityService` lleva objetos: los dos
 * tipos se desviaron y aquí hay que ESCRIBIR el principal, no solo leerle el `organizationId`
 * como hace el interceptor de conexión. Tipar lo que de verdad se maneja evita el cast que
 * ocultaría la diferencia.
 */
interface TenantScopedRequest {
  user?: AuthenticatedUser;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Resuelve la empresa en la que actúa CADA petición, y la autoriza.
 *
 * ## El problema que resuelve
 *
 * El inquilino vivía solo en el token, y cambiar de empresa emitía tokens nuevos. Como el token
 * lo comparten todas las pestañas del navegador, cambiar de empresa en una cambiaba en silencio
 * la empresa en la que escribían las demás: una pestaña mostrando los libros de A y posteando en
 * los de B. En un ERP eso no es una molestia de interfaz, es un asiento en el libro equivocado.
 *
 * Ahora la empresa activa viaja por petición, en una cabecera que el cliente deriva de la propia
 * URL (`/e/{slug}/...`). Dos pestañas en dos empresas distintas son dos cabeceras distintas sobre
 * la misma sesión, y ninguna afecta a la otra.
 *
 * ## Por qué esto no es un agujero
 *
 * La cabecera la controla el cliente, así que **no se cree nada**: se resuelve el slug a una
 * empresa y se comprueba la pertenencia del usuario a ESA empresa contra
 * `user_organizations`, exactamente por el mismo camino que ya autorizaba un token con
 * `organizationId` explícito. Si no pertenece, la petición se rechaza con 403 y se registra.
 *
 * Y el principal no se parchea a medias: se vuelve a resolver completo para la empresa pedida, de
 * modo que los roles y permisos que evalúa `PermissionsGuard` son los de esa empresa y no los de
 * la del token. Copiar solo el `organizationId` habría dejado a un usuario actuando en la empresa
 * B con los permisos que tiene en la A, que es un agujero peor que el que se venía a cerrar.
 *
 * ## Orden
 *
 * Se registra después de `JwtAuthGuard` —necesita `request.user`— y antes de `PermissionsGuard`,
 * que es quien lee los permisos que este guard acaba de recalcular. Ese orden es el de
 * declaración en `app.module.ts`, y `active-tenant.guard.spec.ts` lo fija.
 *
 * Sin cabecera, no cambia nada: la empresa sigue siendo la del token. Eso mantiene funcionando a
 * cualquier cliente antiguo y al POS, y hace que este guard sea aditivo.
 */
@Injectable()
export class ActiveTenantGuard implements CanActivate {
  private readonly logger = new Logger(ActiveTenantGuard.name);

  constructor(
    private readonly organizations: OrganizationLookupPort,
    private readonly identity: PrincipalResolverPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    const user = request.user;
    if (!user) return true; // Ruta pública: no hay empresa que resolver.

    const raw = this.headerValue(request);
    if (!raw) return true;

    const organizationId = await this.resolve(raw);
    if (!organizationId) {
      // Un slug que no existe y uno al que no se tiene acceso responden lo mismo a propósito: la
      // diferencia le diría a cualquiera qué empresas existen en el producto.
      this.logger.warn(
        { event: 'active_tenant_unknown', userId: user.id, requested: raw },
        'La cabecera de empresa activa no resuelve a ninguna empresa',
      );
      throw new ForbiddenError('auth.organization_not_accessible');
    }

    if (organizationId === user.organizationId) return true;

    // Aquí está la autorización: vuelve a resolver el principal para la empresa pedida, lo que
    // comprueba la pertenencia y recalcula roles y permisos para ella.
    try {
      request.user = await this.identity.resolveForOrganization(user, organizationId);
    } catch (error) {
      // Una empresa que existe y no es tuya tiene que responder LO MISMO que una que no existe.
      // Sin esto daba 401 en un caso y 403 en el otro, y esa diferencia es un oráculo: permite
      // enumerar qué empresas hay en el producto probando slugs. La resolución del principal
      // rechaza al no miembro con `INVALID_CREDENTIALS`; solo ese motivo se traduce, y cualquier
      // otro —una cuenta desactivada o bloqueada entre dos peticiones— sigue su camino, porque no
      // habla de la empresa sino de quien pregunta.
      if (isMembershipDenial(error)) {
        this.logger.warn(
          { event: 'active_tenant_denied', userId: user.id, requested: raw },
          'El usuario no pertenece a la empresa que pide la cabecera',
        );
        throw new ForbiddenError('auth.organization_not_accessible');
      }
      throw error;
    }
    return true;
  }

  private headerValue(request: TenantScopedRequest): string | null {
    const headers = (request.headers ?? {}) as Record<string, string | string[] | undefined>;
    const value = headers[ACTIVE_ORGANIZATION_HEADER];
    const single = Array.isArray(value) ? value[0] : value;
    return typeof single === 'string' && single.trim() !== '' ? single.trim() : null;
  }

  /**
   * Acepta el slug o el uuid; null si no es ninguna de las dos cosas.
   *
   * La forma se valida ANTES de consultar: así un valor con caracteres raros no llega al
   * repositorio y el registro de la denegación no arrastra basura.
   */
  private async resolve(raw: string): Promise<string | null> {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID.test(raw) && !isOrganizationSlug(raw)) return null;
    return this.organizations.findIdByRef(raw);
  }
}
