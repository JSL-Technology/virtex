import { AuthenticatedUser } from '../../../security/principal';

/**
 * Los dos servicios que `ActiveTenantGuard` necesita, declarados como puertos.
 *
 * El guard vive en plataforma y se registra como `APP_GUARD` en el módulo raíz, así que no puede
 * importar el repositorio de `organizations` ni el servicio de `auth`: `verify:boundaries`
 * prohíbe importar el interior de otro módulo (`PRIVATE_IMPORT`) y registrar una entidad ajena en
 * `TypeOrmModule.forFeature` (`FOREIGN_ENTITY_REGISTRATION`). Los puertos son la superficie que
 * ese verificador sí admite, y son la forma en la que este repositorio ya rompió los ciclos de
 * Accounting, FixedAssets y Auth.
 */

/** Traduce el identificador de empresa de una URL a su id. */
export abstract class OrganizationLookupPort {
  /**
   * El id de la empresa cuyo slug —o uuid— es `ref`, o null si no existe.
   *
   * Devolver null y no lanzar es deliberado: quien llama no debe poder distinguir «no existe» de
   * «no tienes acceso», porque la diferencia revelaría qué empresas hay en el producto.
   */
  abstract findIdByRef(ref: string): Promise<string | null>;
}

/** Vuelve a resolver el principal para otra empresa del usuario, autorizando la pertenencia. */
export abstract class PrincipalResolverPort {
  abstract resolveForOrganization(
    current: AuthenticatedUser,
    organizationId: string,
  ): Promise<AuthenticatedUser>;
}
