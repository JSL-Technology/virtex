import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * El espacio de trabajo de una persona en una empresa.
 *
 * Clave compuesta (usuario, empresa): la misma persona llevando los libros de dos sociedades
 * tiene dos conjuntos de pestañas, y mezclarlos pondría los documentos de una en la ventana de la
 * otra.
 */
@Entity('user_workspaces')
export class UserWorkspace {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  /**
   * La versión del esquema con la que el cliente escribió esto.
   *
   * Se guarda en vez de asumirse: un cliente antiguo y uno nuevo pueden estar abiertos a la vez
   * durante un despliegue, y el que lee tiene que poder decidir que lo que hay no lo entiende en
   * lugar de restaurar pestañas a medias.
   */
  @Column({ name: 'schema_version', type: 'int' })
  schemaVersion: number;

  /**
   * Sube en cada escritura aceptada.
   *
   * Es lo que permite detectar que otro equipo escribió entremedias. Sin ella, el portátil
   * cerraría en silencio las pestañas que acabas de abrir en el de la oficina.
   */
  @Column({ type: 'int', default: 1 })
  revision: number;

  /** Metadatos de pestaña y disposición de ventanas. Nunca datos de negocio. */
  @Column({ type: 'jsonb' })
  payload: unknown;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
