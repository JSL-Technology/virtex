import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { filter, take } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthQueueService {
  private isRefreshing = false;
  private refreshTokenSubject = new BehaviorSubject<boolean | null>(null);

  constructor() {}

  /**
   * Verifica si ya se está refrescando el token.
   */
  get isRefreshingToken(): boolean {
    return this.isRefreshing;
  }

  /**
   * Inicia el proceso de refresh, bloqueando otras peticiones.
   */
  startRefresh(): void {
    this.isRefreshing = true;
    this.refreshTokenSubject.next(null);
  }

  /**
   * Finaliza el refresh exitosamente, desbloqueando la cola.
   */
  finishRefreshSuccess(): void {
    this.isRefreshing = false;
    this.refreshTokenSubject.next(true);
  }

  /**
   * Finaliza el refresh con error.
   */
  finishRefreshError(): void {
    this.isRefreshing = false;
    this.refreshTokenSubject.next(false);
  }

  /**
   * Espera a que el token se refresque.
   */
  waitForTokenRefresh(): Observable<boolean | null> {
    return this.refreshTokenSubject.pipe(
      filter(token => token !== null),
      take(1)
    );
  }
}
