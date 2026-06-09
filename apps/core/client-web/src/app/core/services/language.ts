import { Injectable, signal, effect, Inject, PLATFORM_ID, inject, untracked } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { UsersService } from '../api/users.service';
import { AuthService } from './auth';

// Clave estandarizada para guardar el idioma en el almacenamiento local del navegador.
const UI_LANG_KEY = 'ui_lang';

@Injectable({
  providedIn: 'root',
})
export class LanguageService {
  // --- Propiedades ---
  private isBrowser: boolean;
  private readonly supportedLangs = ['en', 'es'];
  private readonly defaultLang = 'es';

  // --- Inyección de Dependencias ---
  private translate = inject(TranslateService);
  private usersService = inject(UsersService);
  private authService = inject(AuthService);

  /**
   * Signal que almacena el idioma actual de la UI.
   * Es el estado centralizado; cualquier cambio aquí desencadenará efectos.
   */
  public currentLang = signal<string>(this.defaultLang);

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.initializeLanguage();

    // Efecto que se ejecuta automáticamente cada vez que el signal `currentLang` cambia.
    effect(() => {
      const lang = this.currentLang();
      
      // 1. Actualiza el servicio ngx-translate para que los pipes usen el nuevo idioma.
      this.translate.use(lang);

      // 2. Realiza operaciones solo si estamos en el navegador (evita errores en SSR).
      if (this.isBrowser) {
        // 2a. Guarda la preferencia en localStorage para persistencia entre visitas.
        localStorage.setItem(UI_LANG_KEY, lang);
        
        // 2b. Actualiza el atributo 'lang' de la etiqueta <html> para accesibilidad y SEO.
        document.documentElement.lang = lang;

        // 2c. Sincroniza con el backend si hay un usuario logueado.
        // `untracked` evita que el efecto se vuelva a ejecutar si `currentUser` cambia,
        // solo nos interesa reaccionar a cambios de `currentLang`.
        const currentUser = untracked(this.authService.currentUser);
        if (currentUser && currentUser.preferredLanguage !== lang) {
          this.syncWithUserProfile(currentUser.id, lang);
        }
      }
    });
  }

  /**
   * Configura los idiomas soportados y establece el idioma inicial de la aplicación.
   */
  private initializeLanguage(): void {
    this.translate.addLangs(this.supportedLangs);
    this.translate.setDefaultLang(this.defaultLang);
    const initialLang = this.getInitialLanguage();
    this.currentLang.set(initialLang);
  }

  /**
   * Determina el idioma inicial a usar siguiendo un orden de prioridad.
   * Este método es crucial para el `languageRedirectGuard`.
   * @returns El código de idioma (ej. 'es' o 'en').
   */
  public getInitialLanguage(): string {
    // Si no estamos en un navegador (ej. durante SSR), usamos el idioma por defecto.
    if (!this.isBrowser) {
      return this.defaultLang;
    }

    // Prioridad 1: Idioma guardado en localStorage de una visita anterior.
    const storedLang = localStorage.getItem(UI_LANG_KEY);
    if (storedLang && this.supportedLangs.includes(storedLang)) {
      return storedLang;
    }

    // Prioridad 2: Idioma preferido del navegador del usuario.
    const browserLang = this.translate.getBrowserLang()?.substring(0, 2);
    if (browserLang && this.supportedLangs.includes(browserLang)) {
      return browserLang;
    }

    // Prioridad 3: Fallback al idioma por defecto.
    return this.defaultLang;
  }

  /**
   * Método público para cambiar el idioma de la aplicación.
   * Simplemente actualiza el signal `currentLang`, y el `effect` se encarga del resto.
   * @param lang El nuevo código de idioma a establecer (ej. 'en').
   */
  public setLanguage(lang: string): void {
    if (this.supportedLangs.includes(lang) && lang !== this.currentLang()) {
      this.currentLang.set(lang);
    }
  }

  /**
   * Envía una petición al backend para actualizar la preferencia de idioma en el perfil del usuario.
   * @param userId El ID del usuario logueado.
   * @param lang El nuevo idioma preferido.
   */
  private async syncWithUserProfile(userId: string, lang: string): Promise<void> {
    try {
      await firstValueFrom(
        this.usersService.updateProfile({ preferredLanguage: lang })
      );
      console.log(`Preferencia de idioma del usuario ${userId} sincronizada a '${lang}'.`);
    } catch (error: any) {
      console.error('Falló la sincronización de la preferencia de idioma con el perfil del usuario.', error);
    }
  }
}

