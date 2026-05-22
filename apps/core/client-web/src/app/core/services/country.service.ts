import { Injectable, signal, inject, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { catchError, Observable, of, tap, map } from 'rxjs';
import { GeoLocationService } from './geo-location.service';

export interface CountryConfig {
  code: string;
  name: string;
  currencyCode: string;
  currencySymbol: string;
  locale: string;
  phoneCode: string;
  taxIdLabel: string;
  taxIdRegex: string;
  taxIdMask: string;
  fiscalRegionId?: string; // UUID real de la base de datos
  formSchema: any;
}

@Injectable({
  providedIn: 'root'
})
export class CountryService {
  private http = inject(HttpClient);
  private geoLocation = inject(GeoLocationService);

  // Signal que mantiene la configuración actual del país detectado o seleccionado
  currentCountry = signal<CountryConfig | null>(null);
  
  // Computed para obtener solo el código de manera segura (fallback a 'do' por defecto comercial)
  currentCountryCode = computed(() => this.currentCountry()?.code.toLowerCase() || 'do');

  /**
   * 1. Detecta la ubicación del usuario vía IP (GeoIP).
   * 2. Llama al Backend para obtener la configuración fiscal REAL de ese país.
   */
  detectAndSetCountry(): void {
    this.geoLocation.getGeoLocation().subscribe({
      next: (res) => {
        if (res && res.country) {
          this.getCountryConfig(res.country).subscribe();
        } else {
          // Fallback por defecto si falla la GeoIP: República Dominicana
          this.getCountryConfig('DO').subscribe();
        }
      },
      error: () => {
        // Si falla GeoIP, usar defecto
        this.getCountryConfig('DO').subscribe();
      }
    });
  }

  /**
   * Obtiene la configuración desde el API.
   * CRÍTICO: Obtiene el fiscalRegionId real de la BD para validaciones correctas.
   */
  getCountryConfig(code: string): Observable<CountryConfig> {
    const cached = this.currentCountry();

    // Evitar llamadas duplicadas si ya tenemos la config
    if (cached && cached.code.toLowerCase() === code.toLowerCase()) {
      return of(cached);
    }

    return this.http.get<any>(`${environment.apiUrl}/localization/config/${code}`).pipe(
      map(backendConfig => {
        // Mapeo robusto de la respuesta del backend
        const config: CountryConfig = {
           code: backendConfig.countryCode || code.toUpperCase(),
           name: backendConfig.name || code.toUpperCase(),
           currencyCode: backendConfig.currency || 'USD',
           currencySymbol: backendConfig.currency === 'USD' ? '$' : (backendConfig.currency === 'DOP' ? 'RD$' : '$'),
           locale: backendConfig.locale || 'es-419', // Default LatAm Spanish
           phoneCode: backendConfig.phoneCode || '',
           taxIdLabel: backendConfig.taxIdLabel || 'Tax ID',
           taxIdRegex: backendConfig.taxIdRegex || '.*',
           taxIdMask: backendConfig.taxIdMask || '',
           // CRÍTICO: Aquí asignamos el UUID real que viene de la BD.
           // Si es undefined, el formulario no enviará basura.
           fiscalRegionId: backendConfig.fiscalRegionId,
           formSchema: backendConfig.formSchema || {}
        };
        return config;
      }),
      tap(config => {
        console.log(`[Localization] Configuración cargada para ${config.name}`, config);
        this.currentCountry.set(config);
      }),
      catchError(err => {
        console.error('Error crítico obteniendo configuración regional:', err);
        // En un entorno PROD SaaS, aquí deberíamos notificar al usuario o reintentar.
        // Retornamos un objeto mínimo seguro para no romper la UI, pero SIN IDs falsos.
        const safeFallback: CountryConfig = {
            code: code.toUpperCase(),
            name: code.toUpperCase(),
            currencyCode: 'USD',
            currencySymbol: '$',
            locale: 'en-US',
            phoneCode: '',
            taxIdLabel: 'Tax ID',
            taxIdRegex: '.*',
            taxIdMask: '',
            fiscalRegionId: undefined, // Importante: undefined es mejor que un UUID inválido
            formSchema: {}
        };
        this.currentCountry.set(safeFallback);
        return of(safeFallback);
      })
    );
  }

  // Validación remota contra la DGII (DO) u otros servicios gubernamentales
  lookupTaxId(taxId: string, countryCode: string): Observable<any> {
      return this.http.get<any>(`${environment.apiUrl}/localization/lookup/${taxId}?country=${countryCode}`);
  }
}
