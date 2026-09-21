import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserWorkspace } from './user-workspace.entity';

/** Lo que el cliente manda al guardar. */
export interface WorkspaceWrite {
  schemaVersion: number;
  payload: unknown;
  /** La revisión que el cliente vio por última vez. `0` significa «no tenía nada». */
  baseRevision: number;
}

/** Lo que el servidor devuelve. */
export interface WorkspaceRead {
  schemaVersion: number;
  payload: unknown;
  revision: number;
  updatedAt: string;
}

/** Una escritura rechazada porque otro equipo escribió entremedias. */
export interface WorkspaceConflict {
  conflict: true;
  current: WorkspaceRead;
}

/**
 * Las filas que devolvió un `RETURNING`, sea cual sea la forma en que `query()` las entregue.
 *
 * Para un UPDATE devuelve `[filas, contador]`; para un INSERT, las filas directamente. Esa
 * diferencia costó dos defectos que solo aparecieron al ejecutar: primero leer el contador como si
 * fuera una fila —un 500 al formatear una fecha inexistente—, y después contar un INSERT sin
 * `RETURNING`, que devuelve una lista vacía aunque haya insertado, de modo que la primera
 * escritura se reportaba como conflicto. Con `RETURNING` en las dos sentencias y esta
 * normalización, «cuántas filas escribí» tiene una sola respuesta.
 */
function returnedRows<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  if (Array.isArray(result)) return result as T[];
  return [];
}

@Injectable()
export class UserWorkspaceService {
  constructor(
    @InjectRepository(UserWorkspace)
    private readonly repository: Repository<UserWorkspace>,
  ) {}

  async read(userId: string, organizationId: string): Promise<WorkspaceRead | null> {
    const row = await this.repository.findOne({ where: { userId, organizationId } });
    return row ? this.toRead(row) : null;
  }

  /**
   * Guarda el espacio de trabajo, o dice que ha cambiado desde lo que el cliente vio.
   *
   * ## Por qué no «el último gana»
   *
   * Dos equipos abiertos a la vez escriben la misma fila. Con «el último gana», el portátil
   * cierra en silencio las pestañas que acabas de abrir en el de la oficina, y nadie se enteraría
   * hasta echar en falta un documento. Comparando la revisión, el servidor puede decir «esto
   * cambió» y devolver lo que tiene, para que el cliente una los dos conjuntos.
   *
   * ## Por qué la comparación va en el UPDATE
   *
   * Leer la revisión y después escribir deja una ventana entre las dos consultas por la que se
   * cuela la escritura del otro equipo. La condición viaja en el `WHERE` del propio UPDATE, así
   * que es la base de datos la que decide, en una sola operación, y no hay ventana que perder.
   */
  async write(
    userId: string,
    organizationId: string,
    write: WorkspaceWrite,
  ): Promise<WorkspaceRead | WorkspaceConflict> {
    const payload = JSON.stringify(write.payload);

    // La escritura es CONDICIONAL y la lectura posterior solo compone la respuesta. Se separan a
    // propósito: la condición vive en el `WHERE`, así que es la base de datos la que decide en una
    // sola operación si esta escritura llega a tiempo, y no hay ventana entre leer y escribir por
    // la que colar la del otro equipo.
    //
    // Antes esto leía la fila del `RETURNING`, y ahí había un defecto que solo aparecía al
    // ejecutarlo: `query()` devuelve las filas para un INSERT y `[filas, contador]` para un
    // UPDATE, de modo que el camino de actualización leía el contador como si fuera una fila y
    // respondía 500 al formatear una fecha que no existía. Releer por clave primaria no tiene
    // forma ambigua.
    const affected =
      write.baseRevision === 0
        ? await this.insertIfAbsent(userId, organizationId, write.schemaVersion, payload)
        : await this.updateIfCurrent(
            userId,
            organizationId,
            write.schemaVersion,
            payload,
            write.baseRevision,
          );

    const current = await this.read(userId, organizationId);

    if (affected > 0) {
      // La fila acaba de escribirse, así que existe. El `?? ` cubre la carrera en la que un cierre
      // de sesión la borró en el intervalo; devolver lo que se pidió es más útil que un error.
      return (
        current ?? {
          schemaVersion: write.schemaVersion,
          payload: write.payload,
          revision: write.baseRevision + 1,
          updatedAt: new Date().toISOString(),
        }
      );
    }

    // Sin fila: la borró un cierre de sesión o desapareció la empresa. Se reintenta como primera
    // escritura, que es lo que de hecho es ahora.
    if (!current) {
      return write.baseRevision === 0
        ? {
            schemaVersion: write.schemaVersion,
            payload: write.payload,
            revision: 1,
            updatedAt: new Date().toISOString(),
          }
        : this.write(userId, organizationId, { ...write, baseRevision: 0 });
    }

    return { conflict: true, current };
  }

  /** Inserta si nadie se ha adelantado. Devuelve cuántas filas escribió: 1 o 0. */
  private async insertIfAbsent(
    userId: string,
    organizationId: string,
    schemaVersion: number,
    payload: string,
  ): Promise<number> {
    const result = await this.repository.query(
      `INSERT INTO "user_workspaces"
         ("user_id", "organization_id", "schema_version", "revision", "payload")
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT ("user_id", "organization_id") DO NOTHING
       RETURNING 1 AS escrito`,
      [userId, organizationId, schemaVersion, payload],
    );
    return returnedRows(result).length;
  }

  /** Actualiza solo si la revisión sigue siendo la que el cliente vio. */
  private async updateIfCurrent(
    userId: string,
    organizationId: string,
    schemaVersion: number,
    payload: string,
    baseRevision: number,
  ): Promise<number> {
    const result = await this.repository.query(
      `UPDATE "user_workspaces"
          SET "payload" = $4,
              "schema_version" = $3,
              "revision" = "revision" + 1,
              "updated_at" = now()
        WHERE "user_id" = $1 AND "organization_id" = $2 AND "revision" = $5
        RETURNING 1 AS escrito`,
      [userId, organizationId, schemaVersion, payload, baseRevision],
    );
    return returnedRows(result).length;
  }

  /** Olvida el espacio de trabajo. Lo usa «no recordar mis pestañas». */
  async forget(userId: string, organizationId: string): Promise<void> {
    await this.repository.delete({ userId, organizationId });
  }

  private toRead(row: UserWorkspace): WorkspaceRead {
    return {
      schemaVersion: row.schemaVersion,
      payload: row.payload,
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
