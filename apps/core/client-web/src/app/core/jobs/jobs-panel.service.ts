import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface TenantJob {
  id: string;
  queue: string;
  name: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'unknown';
  progress: number | null;
  createdAt: string;
  finishedAt: string | null;
  failedReason: string | null;
}

/**
 * Los trabajos largos que esta empresa tiene en marcha.
 *
 * ## Por qué esto existe
 *
 * Fusionar cuentas, postear entre empresas o generar asientos recurrentes se encolan: la pantalla
 * responde de inmediato y el trabajo ocurre después. Sin panel, la única señal que recibe una
 * persona es que nada cambia — y si el trabajo falla, tras tres reintentos, no se entera nadie
 * salvo el registro del servidor.
 *
 * ## Por qué sondea, y solo mientras haya algo corriendo
 *
 * Un trabajo en marcha es justo el caso en el que el estado cambia solo, sin que el usuario haga
 * nada, así que aquí el sondeo sí se gana su coste. Se detiene en cuanto no queda ninguno activo:
 * sondear una cola vacía es pagar por preguntar siempre lo mismo.
 */
@Injectable({ providedIn: 'root' })
export class JobsPanelService {
  private readonly http = inject(HttpClient);
  private readonly state = signal<TenantJob[]>([]);
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly jobs = this.state.asReadonly();

  /** Los que siguen en marcha: lo que justifica volver a preguntar. */
  readonly running = computed(() =>
    this.state().filter((j) => j.state === 'active' || j.state === 'waiting' || j.state === 'delayed'),
  );

  /** Los que fallaron y nadie ha visto todavía. Es lo que el panel tiene que destacar. */
  readonly failed = computed(() => this.state().filter((j) => j.state === 'failed'));

  async refresh(): Promise<void> {
    try {
      this.state.set((await firstValueFrom(this.http.get<TenantJob[]>('/api/v1/me/jobs'))) ?? []);
    } catch (error) {
      // Se conserva lo último conocido: vaciar diría que no hay trabajos, que es más de lo que se
      // sabe cuando la petición falló.
      console.info('[jobs] no se pudo leer el panel de trabajos', error);
    }
    this.scheduleNext();
  }

  /**
   * Vuelve a preguntar mientras quede algo en marcha.
   *
   * Cinco segundos: lo bastante para que un trabajo de unos segundos se vea terminar, y lo bastante
   * espaciado para que una sesión abierta toda la tarde con la cola vacía no haga una sola
   * petición de más — porque con la cola vacía no se programa ninguna.
   */
  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running().length === 0) return;
    this.timer = setTimeout(() => void this.refresh(), 5000);
  }

  /** Deja de sondear. Lo llama el armazón al cerrar sesión o al cambiar de empresa. */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state.set([]);
  }
}
