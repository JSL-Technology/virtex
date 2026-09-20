import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { DocumentLifecycle } from '@virteex/shared/types';

/**
 * Los ciclos de vida declarados, leídos una vez.
 *
 * ## Por qué se piden al servidor y no se escriben aquí
 *
 * Porque el servidor es quien RECHAZA una transición. Una copia en el navegador se desincroniza en
 * la primera regla que alguien cambie en un solo sitio, y el síntoma es el peor posible: un botón
 * que se ve habilitado y una petición que vuelve con un error que el usuario no puede explicarse.
 * Con esto, la tira de etapas que se dibuja es literalmente la tabla con la que el servidor decide.
 *
 * ## Por qué una sola petición y una sola vez
 *
 * No son datos de ningún inquilino ni cambian durante una sesión: son las reglas del producto. Se
 * piden al arrancar el primer documento que las necesite y se guardan. Un fallo no se reintenta en
 * bucle — se deja sin tira, que es honesto: mejor no dibujar el recorrido que dibujar uno inventado.
 */
@Injectable({ providedIn: 'root' })
export class DocumentLifecycleService {
  private readonly http = inject(HttpClient);
  private readonly byType = signal<Map<string, DocumentLifecycle>>(new Map());
  private pending: Promise<void> | null = null;

  readonly lifecycles = this.byType.asReadonly();

  /**
   * El ciclo de vida de un tipo de documento, o `null` mientras no se haya leído o si el módulo
   * no lo declara. La mayoría de los documentos del producto todavía están en el segundo caso.
   */
  get(documentType: string): DocumentLifecycle | null {
    return this.byType().get(documentType) ?? null;
  }

  /** Se asegura de haberlos leído. Llamarlo dos veces no dispara dos peticiones. */
  async load(): Promise<void> {
    if (this.byType().size > 0) return;
    this.pending ??= this.fetch().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetch(): Promise<void> {
    try {
      const declarados = await firstValueFrom(
        this.http.get<DocumentLifecycle[]>('/api/v1/lifecycles'),
      );
      this.byType.set(new Map((declarados ?? []).map((l) => [l.documentType, l])));
    } catch (error) {
      console.info('[lifecycle] no se pudieron leer los ciclos de vida declarados', error);
    }
  }
}
