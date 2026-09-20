import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/** Lo que el servidor guarda: la revisión más la carga que le mandó el cliente. */
export interface RemoteWorkspace {
  schemaVersion: number;
  payload: unknown;
  revision: number;
  updatedAt: string;
}

type SaveResult = RemoteWorkspace | { conflict: true; current: RemoteWorkspace };

/**
 * El espacio de trabajo, en el servidor.
 *
 * ## Qué añade sobre `localStorage`
 *
 * `localStorage` cubre F5 y cerrar el navegador. No cubre lo que la gente hace: empezar un cierre
 * contable en la oficina y seguirlo en casa. Sin esto, cada equipo era un espacio de trabajo
 * distinto sin que nada lo dijera.
 *
 * Los dos niveles se quedan, y no se estorban: el local es el rápido —restaura sin pedir nada a
 * nadie, así que no hay parpadeo al abrir— y el remoto llega después y se une al local. Por eso
 * `TabPersistenceService` restaura primero de local y consulta el servidor a continuación, en vez
 * de esperar la respuesta para dibujar.
 *
 * ## Por qué nada de esto rompe nada si falla
 *
 * Toda operación devuelve null ante un error y lo anota. Un ERP no puede quedarse sin pestañas
 * porque la red se cayó: el nivel local sigue funcionando y el remoto se reintenta en el siguiente
 * cambio. Por la misma razón no hay ningún `await` en el camino de dibujado.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceSyncService {
  private readonly http = inject(HttpClient);
  private static readonly URL = '/api/v1/me/workspace';

  /**
   * La última revisión conocida de ESTE navegador.
   *
   * Empieza en 0, que significa «no he visto ninguna»: es lo que distingue una primera escritura
   * de una actualización, y lo que permite al servidor detectar que otro equipo llegó antes.
   */
  private revision = 0;

  async pull(): Promise<RemoteWorkspace | null> {
    try {
      const remote = await firstValueFrom(
        this.http.get<RemoteWorkspace | null>(WorkspaceSyncService.URL),
      );
      if (remote) this.revision = remote.revision;
      return remote ?? null;
    } catch (error) {
      console.info('[workspace] no se pudo leer el espacio de trabajo del servidor', error);
      return null;
    }
  }

  /**
   * Guarda, y si otro equipo escribió entremedias devuelve lo que hay para que quien llama una
   * los dos conjuntos y vuelva a intentarlo.
   *
   * No reintenta por su cuenta: unir es una decisión sobre pestañas, y este servicio no sabe de
   * pestañas. Reintentar aquí con la carga vieja sería pisar al otro equipo, que es exactamente lo
   * que la revisión existe para impedir.
   */
  async push(
    schemaVersion: number,
    payload: unknown,
  ): Promise<{ saved: true } | { conflict: RemoteWorkspace } | null> {
    try {
      const result = await firstValueFrom(
        this.http.put<SaveResult>(WorkspaceSyncService.URL, {
          schemaVersion,
          payload,
          baseRevision: this.revision,
        }),
      );

      if (!result) return { saved: true };
      if ('conflict' in result) {
        this.revision = result.current.revision;
        return { conflict: result.current };
      }
      this.revision = result.revision;
      return { saved: true };
    } catch (error) {
      console.info('[workspace] no se pudo guardar el espacio de trabajo en el servidor', error);
      return null;
    }
  }

  /** Olvida el espacio de trabajo guardado. Lo usa «no recordar mis pestañas». */
  async forget(): Promise<void> {
    try {
      await firstValueFrom(this.http.delete<void>(WorkspaceSyncService.URL));
      this.revision = 0;
    } catch (error) {
      console.info('[workspace] no se pudo olvidar el espacio de trabajo del servidor', error);
    }
  }

  /**
   * Devuelve la revisión a cero.
   *
   * Hace falta al cambiar de empresa: el espacio de trabajo es por (persona, empresa), así que la
   * revisión que este navegador conocía es de OTRO registro. Reutilizarla haría que la primera
   * escritura en la empresa nueva pareciera una actualización de algo que nunca vio.
   */
  resetRevision(): void {
    this.revision = 0;
  }
}
