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

  /** Token de acceso JWT del usuario. */
  token: string;
  isOnline: boolean;

  department?: string;
  avatarUrl?: string;
  online: boolean;
  phone?: string;
  jobTitle?: string;

  // **************************************************

  // isActive: boolean;
  passwordHash: string | null; // El backend no lo envía, pero la entidad lo tiene

  isImpersonating?: boolean;
  originalUserId?: string;

  organization: Organization;

  preferredLanguage?: string;
  isTwoFactorEnabled?: boolean;
}
