/**
 * Quién hace la petición, tal como lo ve el resto de la aplicación.
 *
 * ## Por qué esto está en `security` y no en `auth`
 *
 * 79 archivos de los nueve módulos importaban `AuthenticatedUser` desde
 * `auth/interfaces/authenticated-user.interface`, y ese tipo era
 * `Partial<Omit<User, 'password' | 'twoFactorSecret'>>` — es decir, la forma de la **tabla
 * `users`**, con todas sus columnas en opcional. Un controlador de Inventario que solo quería el
 * `organizationId` del solicitante quedaba acoplado al esquema de persistencia del módulo de
 * Identidad: añadir una columna a `users` cambiaba el tipo del principal en todo el producto.
 *
 * El principal de una petición es un contrato de la plataforma, no una proyección de una entidad.
 * Aquí está escrito explícitamente, campo por campo. Resultó que el `Partial<User>` estaba
 * prácticamente sin usar: quitarlo produjo tres errores de compilación en un único archivo, los
 * tres por campos que sí pertenecen al principal y que ahora están declarados abajo.
 *
 * ## Qué NO va aquí
 *
 * `SafeUser`, `UserIdentity` y `TenantPrincipal` se quedan en `auth`: solo los usa `auth`, y los
 * tres sí son proyecciones legítimas de la entidad dentro del módulo que la posee.
 */

/**
 * La organización que el principal trae consigo, reducida a lo que un consumidor puede necesitar.
 *
 * Era la entidad `Organization` completa, lo que convertía cada lectura de `request.user` en una
 * dependencia sobre las tablas de Identidad. Los servicios de `auth` que necesitan la entidad la
 * leen de su propio repositorio, que es donde corresponde.
 */
export interface PrincipalOrganization {
  id: string;
  name?: string;
}

/**
 * Un rol tal como viaja en el principal.
 *
 * Era `any[]`. `organizationId` es nullable porque un rol de sistema no pertenece a ningún tenant.
 */
export interface PrincipalRole {
  id: string;
  name?: string;
  organizationId?: string | null;
  permissions?: string[];
  isSystemRole?: boolean;
}

/**
 * El principal de la petición.
 *
 * `organizationId` es `string`, no `string | null`, y esa diferencia es el motivo de que este tipo
 * exista aparte de la entidad: `User.organizationId` es nullable porque la columna lo es, mientras
 * que un principal que pasó el guard de autenticación siempre tiene tenant —`UserIdentityService`
 * rechaza la petición si no—. Tipar los controladores con la entidad empujaba esa nulabilidad a
 * los 52 controladores, donde producía 193 errores `'string | null' is not assignable to 'string'`
 * y, en el código que los silenciaba, la suposición de que el valor estaba ahí sin nada que lo
 * garantizara.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Siempre presente: el guard de autenticación no deja pasar un principal sin tenant. */
  organizationId: string;
  roles: PrincipalRole[];
  permissions: string[];
  organization?: PrincipalOrganization;
  isTwoFactorEnabled?: boolean;
  phone?: string | null;
  isPhoneVerified?: boolean;

  /** Puesto por la suplantación administrativa; `originalUserId` es quien la inició. */
  isImpersonating?: boolean;
  originalUserId?: string;
  sessionId?: string;
}
