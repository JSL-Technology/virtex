
import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

/**
 * El acceso de una persona de un proveedor al portal de proveedores.
 *
 * ## Por qué esta tabla ya no guarda permisos
 *
 * Declaraba `permissions: string[]`, y nada en el producto la leía: ni un guard, ni un servicio,
 * ni un controlador. Era un SEGUNDO modelo de autorización, dormido en el esquema, paralelo al de
 * `roles` — y el día que alguien construyera el portal encima de esa columna habría tenido un
 * mecanismo de permisos que `PermissionsGuard` no conoce.
 *
 * Esa es exactamente la forma de defecto que este repositorio ya ha pagado tres veces por
 * separado: un control declarado por endpoint llegó a 4 de 50 controladores en CSRF, a 1 de 67 en
 * entitlement y a 47 de 76 en permisos. La lección que sacó fue «un solo mecanismo, global, y la
 * excepción escrita». Una segunda tabla de permisos la contradice antes de tener un solo usuario.
 *
 * Y el nivel de seguridad real de un sistema lo fija su mecanismo MÁS DÉBIL, no el mejor: dos
 * formas de decidir qué puede hacer alguien significa que manda la más floja.
 *
 * ## Qué se hace en su lugar
 *
 * Lo que una persona de un proveedor puede hacer se expresa como un `Role` con el
 * `organization_id` del inquilino que la invitó, igual que para cualquier otro miembro. Así pasa
 * por `UserIdentityService.permissionsFor`, por `PermissionsGuard`, por las comprobaciones de
 * delegación de `RolesService` y por el catálogo de permisos — sin nada nuevo que recordar.
 *
 * Esta tabla se queda con lo único que es suyo y no de nadie más: A QUÉ PROVEEDOR representa esta
 * persona, y si ese acceso sigue vivo.
 */
@Entity('supplier_portal_users')
export class SupplierPortalUser extends BaseEntity {
  @Column({ name: 'supplier_id', type: 'uuid' })
  supplierId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /**
   * Si el acceso al portal sigue vigente.
   *
   * Es una pregunta sobre la RELACIÓN con el proveedor —«¿sigue trabajando con nosotros?»— y no
   * sobre los derechos de la persona, así que no se solapa con los roles: una cuenta puede tener
   * su rol intacto y este vínculo cerrado.
   */
  @Column({ default: true })
  isActive: boolean;
}
