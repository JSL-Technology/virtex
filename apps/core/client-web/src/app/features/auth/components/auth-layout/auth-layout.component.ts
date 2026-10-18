import { ChangeDetectionStrategy, Component, Input, computed, inject, signal } from '@angular/core';
import { ThemeService } from '../../../../core/services/theme';

import { BrandLogo } from '../../../../shared/components/brand-logo/brand-logo';
import { ThemeToggle } from '../../../../shared/components/theme-toggle/theme-toggle';
import { AuthFooterComponent } from '../auth-footer/auth-footer.component';
import { TranslateModule } from '@virteex/shared/ui-i18n';

/**
 * Marco común de las pantallas públicas: acceso, registro, recuperación de
 * contraseña y confirmación de pago.
 *
 * ── Qué aporta ──────────────────────────────────────────────────────────────
 * Un lienzo de aurora en movimiento y, flotando sobre él, una lámina de
 * cristal. Cada pantalla se limita a proyectar su contenido dentro de la
 * lámina; ninguna vuelve a decidir por su cuenta el fondo, el ancho o la
 * sombra, que es como acabaron divergiendo entre sí.
 *
 * ── El conmutador de tema vive aquí ─────────────────────────────────────────
 * Y no en la aplicación autenticada, donde estaba: quien todavía no ha entrado
 * no tiene preferencias guardadas en servidor, así que la primera pantalla del
 * producto es exactamente donde hace falta poder elegir claro u oscuro. Sin
 * esto, un usuario con el sistema en oscuro no tenía forma de ver la pantalla
 * de acceso en claro.
 */
@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [AuthFooterComponent, BrandLogo, ThemeToggle, TranslateModule],
  templateUrl: './auth-layout.component.html',
  styleUrls: ['./auth-layout.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthLayoutComponent {
  /**
   * Ancho de la lámina. El registro es un asistente de seis pasos con campos
   * en dos columnas y ahogaría en la medida del acceso; el acceso, a la
   * inversa, se vería desierto en la del registro.
   */
  @Input() width: 'compact' | 'wide' = 'compact';

  /** Oculta la marca superior en pantallas que traen la suya propia. */
  @Input() showBrand = true;

  /**
   * Fotografía de fondo del tema OSCURO. Por defecto, la misma para todas las
   * puertas de entrada —acceso, alta, confirmación del pago—: que la pantalla
   * final del alta tuviera otro fondo la hacía parecer otro producto (QA A-11).
   *
   * Solo en oscuro. La foto es una seda casi negra, y en el tema claro dejaba
   * la pantalla de acceso «casi negra» con el pie gris sobre gris (QA M-14):
   * quien eligió claro veía oscuro. En claro se pintan los velos de aurora, que
   * sí tienen lectura clara.
   */
  @Input() set backgroundImage(value: string | null) {
    this.photo.set(value);
  }

  private readonly theme = inject(ThemeService);
  private readonly photo = signal<string | null>(AUTH_BACKGROUND_PHOTO);

  /** La foto que se pinta ahora mismo, o `null` para los velos de aurora. */
  readonly activePhoto = computed(() => (this.theme.isDark() ? this.photo() : null));
}

/** La fotografía común de las pantallas de acceso en tema oscuro. */
export const AUTH_BACKGROUND_PHOTO =
  'assets/images/vibrant-liquid-wavy-background-3d-illustration-abstract-iridescent-fluid-render-neon-holographic-smooth-surface-with-colorful-interference-stylish-spectrum-flow-motion.jpg';
