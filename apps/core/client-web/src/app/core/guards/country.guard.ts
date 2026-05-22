import { Injectable, inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import { CountryService } from '../services/country.service';
import { LanguageService } from '../services/language';
import { GeoLocationService } from '../services/geo-location.service';

@Injectable({
  providedIn: 'root'
})
export class CountryGuard implements CanActivate {
  private countryService = inject(CountryService);
  private languageService = inject(LanguageService);
  private geoService = inject(GeoLocationService);
  private router = inject(Router);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | boolean | UrlTree {
    const countryCode = route.paramMap.get('country');
    const langCode = route.paramMap.get('lang');

    // Validación básica: si falta algo, redirigir al login por defecto
    if (!countryCode || !langCode) {
       return this.router.createUrlTree(['/es/do/auth/login']);
    }

    // Establecer idioma
    this.languageService.setLanguage(langCode);

    // Obtener Configuración de País
    return this.countryService.getCountryConfig(countryCode).pipe(
      map((config) => {
        // Lógica de Redirección Inteligente:
        // Si el código de la configuración obtenida (config.code) es diferente al de la URL (countryCode),
        // significa que el país de la URL no existe y el servicio nos dio uno por defecto (fallback).
        // En ese caso, redirigimos al usuario a la URL con el código correcto.
        if (config && config.code.toLowerCase() !== countryCode.toLowerCase()) {
            const url = state.url; // ej: /es/asdfas/auth/register
            const segments = url.split('/'); 
            
            // Asumiendo estructura estándar: ['', ':lang', ':country', ...]
            // Reemplazamos el segmento del país (índice 2) por el código válido
            if (segments.length > 2) {
                segments[2] = config.code.toLowerCase();
                const newUrl = segments.join('/');
                // Redirige a /es/us/auth/register (o el país por defecto que devuelva el servicio)
                return this.router.parseUrl(newUrl);
            }
        }
        
        // Si coinciden, permitimos la navegación
        return true;
      }),
      tap(() => this.geoService.checkAndNotifyMismatch(countryCode)),
      catchError(() => {
        // En caso de error crítico (API caída), intentar redirigir a 'do' preservando la ruta
        const fallbackCountry = 'do';
        const segments = state.url.split('/');
        if (segments.length > 2) {
            segments[2] = fallbackCountry;
            return of(this.router.parseUrl(segments.join('/')));
        }
        // Si todo falla, al login
        return of(this.router.createUrlTree(['/es/do/auth/login']));
      })
    );
  }
}