import { Role } from '../../core/api/roles.service';
import { UserStatus } from '../enums/user-status.enum';

export interface Organization {
  id: string;
  name?: string;
  logoUrl?: string;
  subscriptionStatus?: string;
  gracePeriodEnd?: Date | string;
}

/**
 * Representa la estructura de un usuario en la aplicación.
 * Esta interfaz debe mantenerse alineada con la entidad `User` del backend.
 *
 *
 *
 *
 */
export interface User {
  /** Identificador único del usuario (UUID). */
  id: string;

  /** Correo electrónico del usuario. */
  email: string;

  /** Nombre del usuario. */
  firstName: string;

  /** Apellido del usuario. */
  lastName: string;

  /** Indica si la cuenta del usuario está activa. */
  // isActive: boolean;

  /**
   * Lista de roles asignados al usuario.
   * Cada elemento es un objeto Role con sus propiedades.
   */
  roles: Role[];

  // 3. Añade la nueva propiedad de estado
  status: UserStatus;

  /**
   * Lista de permisos calculados del usuario.
   * El backend los añade al payload del JWT a partir de los roles.
   * Ejemplo: ["users.create", "users.delete"]
   */
  permissions: string[];

  // H3 FIX: `token` and `passwordHash` were removed from this interface. The backend delivers
  // access/refresh tokens exclusively via httpOnly cookies (never in the body) and never
  // serializes the password hash. Modeling them here invited developers to re-expose secrets in
  // responses or to render/log them if they ever leaked. Keep this contract free of any secret
  // material. (OWASP API3 Excessive Data Exposure; ASVS data minimization; CWE-200/CWE-922.)
  isOnline: boolean;

  department?: string;
  avatarUrl?: string;
  online: boolean;
  phone?: string;
  jobTitle?: string;

  isImpersonating?: boolean;
  originalUserId?: string;

  organization: Organization;

  preferredLanguage?: string;
  isTwoFactorEnabled?: boolean;
}
