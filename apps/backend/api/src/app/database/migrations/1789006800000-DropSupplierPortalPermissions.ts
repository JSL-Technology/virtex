import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retira el segundo almacén de permisos que dormía en el esquema.
 *
 * `supplier_portal_users.permissions` era un `simple-array` que ningún guard, ningún servicio y
 * ningún controlador leía: un modelo de autorización paralelo al de `roles`, esperando a que
 * alguien construyera el portal de proveedores encima de él.
 *
 * Este repositorio ya midió tres veces lo que pasa cuando el mismo control se decide en dos
 * sitios —CSRF llegó a 4 de 50 controladores, entitlement a 1 de 67, permisos a 47 de 76— y su
 * conclusión fue un solo mecanismo global con la excepción escrita. Una segunda tabla de permisos
 * la contradice antes de tener un usuario, y el nivel real de un sistema lo fija su mecanismo más
 * débil.
 *
 * Lo que una persona de un proveedor puede hacer se expresa como un `Role` del inquilino que la
 * invitó, que es lo que `PermissionsGuard` ya sabe leer. La tabla se queda con a qué proveedor
 * representa y si el acceso sigue vivo.
 *
 * La columna está vacía en todas las instalaciones —nada la escribía tampoco—, así que la vuelta
 * atrás la recrea vacía y no pierde nada.
 */
export class DropSupplierPortalPermissions1789006800000 implements MigrationInterface {
  name = 'DropSupplierPortalPermissions1789006800000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'supplier_portal_users'
             AND column_name = 'permissions'
        ) THEN
          ALTER TABLE "supplier_portal_users" DROP COLUMN "permissions";
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'supplier_portal_users'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'supplier_portal_users'
             AND column_name = 'permissions'
        ) THEN
          ALTER TABLE "supplier_portal_users" ADD COLUMN "permissions" text;
        END IF;
      END
      $$;
    `);
  }
}
