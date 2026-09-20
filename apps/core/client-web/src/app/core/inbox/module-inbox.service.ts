import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/** Una cosa concreta que espera a alguien, tal como la cuenta su módulo. */
export interface InboxItem {
  id: string;
  titleKey: string;
  titleParams?: Record<string, string | number>;
  /** Ruta del manifiesto, SIN empresa: la pone `ActiveOrganizationService`. */
  route: string;
  blockedSince: string;
}

export interface ModuleInbox {
  moduleId: string;
  count: number;
  items: InboxItem[];
}

/**
 * Lo que está pendiente, por módulo.
 *
 * ## Por qué una sola consulta y no una por módulo
 *
 * El riel pinta hasta diez insignias y la bandeja las enumera. Con una petición por módulo serían
 * diez viajes en cada carga, y —peor— diez respuestas que pueden discrepar: la insignia diría 3 y
 * la bandeja mostraría 2 porque una llegó un segundo después. Una sola respuesta no puede
 * desmentirse a sí misma.
 *
 * ## Por qué se refresca a mano y no en bucle
 *
 * Un sondeo cada pocos segundos multiplica por diez el coste de cada sesión abierta para cambiar
 * un número que casi nunca cambia. Se pide al entrar y después de cada acción que pueda haber
 * vaciado una cola, que es cuando de verdad cambió.
 */
@Injectable({ providedIn: 'root' })
export class ModuleInboxService {
  private readonly http = inject(HttpClient);
  private readonly state = signal<ModuleInbox[]>([]);
  private readonly loading = signal(false);

  readonly modules = this.state.asReadonly();

  /** Lo pendiente de un módulo, para su insignia. Cero si no tiene nada o aún no se ha pedido. */
  countFor(moduleId: string): number {
    return this.state().find((m) => m.moduleId === moduleId)?.count ?? 0;
  }

  /** El total, para la insignia de «Mi trabajo». */
  readonly total = computed(() => this.state().reduce((sum, m) => sum + m.count, 0));

  readonly isLoading = this.loading.asReadonly();

  /**
   * Vuelve a preguntar.
   *
   * Un fallo deja la bandeja como estaba y lo anota. Vaciarla ante un error diría que no hay nada
   * pendiente, que es una afirmación mucho más fuerte —y más peligrosa— que «no pude preguntar».
   */
  async refresh(): Promise<void> {
    this.loading.set(true);
    try {
      const modules = await firstValueFrom(this.http.get<ModuleInbox[]>('/api/v1/me/inbox'));
      this.state.set(modules ?? []);
    } catch (error) {
      console.info('[inbox] no se pudo leer el trabajo pendiente', error);
    } finally {
      this.loading.set(false);
    }
  }
}
