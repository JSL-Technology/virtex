import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of, catchError, Observable, timer, switchMap, filter } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Router, NavigationStart } from '@angular/router'; // 1. Importar Router y eventos

export interface GeoLocationResponse {
  country: string | null;
  ip: string;
}

@Injectable({
  providedIn: 'root'
})
export class GeoLocationService {
  private http = inject(HttpClient);
  private router = inject(Router); // 2. Inyectar Router

  mismatchSignal = signal<{ detected: string, current: string } | null>(null);

  private readonly SIMULATE_COUNTRY_CODE: string | null = null;

  constructor() {
    // 3. Limpiar la señal cada vez que inicia una navegación
    this.router.events.pipe(
      filter(event => event instanceof NavigationStart)
    ).subscribe(() => {
      this.mismatchSignal.set(null);
    });
  }

  getGeoLocation(): Observable<GeoLocationResponse> {
    if (this.SIMULATE_COUNTRY_CODE) {
      return of({ country: this.SIMULATE_COUNTRY_CODE, ip: '0.0.0.0 (simulated)' });
    }

    return this.http.get<GeoLocationResponse>(`${environment.apiUrl}/geo/location`).pipe(
        catchError(() => {
            return of({ country: null, ip: '' });
        })
    );
  }

  checkAndNotifyMismatch(routeCountryCode: string) {
    if (!routeCountryCode) return;

    timer(2000).pipe(
        switchMap(() => this.getGeoLocation())
    ).subscribe(response => {
      // 4. VERIFICACIÓN CRÍTICA:
      // Si al momento de completarse el timer, la URL actual NO contiene el código de país
      // que estamos verificando, significa que el usuario navegó a otra parte (ej: login o dashboard).
      // En ese caso, cancelamos la operación.
      const currentUrl = this.router.url.toLowerCase();
      const targetSegment = `/${routeCountryCode.toLowerCase()}/`;

      if (!currentUrl.includes(targetSegment)) {
        return; 
      }

      const detected = response.country;

      if (detected && routeCountryCode.toLowerCase() !== detected.toLowerCase()) {
        this.mismatchSignal.set({
            detected: detected.toUpperCase(),
            current: routeCountryCode.toUpperCase()
        });
      } else {
        this.mismatchSignal.set(null);
      }
    });
  }
}