// app/shared/interfaces/user-payload.interface.ts

/**
 * Define la estructura de datos (payload) que se envía a la API
 * para invitar o actualizar la información de un usuario.
 */
export interface UserPayload {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string; // El ID del rol que se va a asignar
  department?: string; // Opcional
}