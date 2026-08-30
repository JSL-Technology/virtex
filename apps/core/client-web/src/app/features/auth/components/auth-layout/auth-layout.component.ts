import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { BrandLogo } from '../../../../shared/components/brand-logo/brand-logo';
import { ThemeToggle } from '../../../../shared/components/theme-toggle/theme-toggle';
import { AuthFooterComponent } from '../auth-footer/auth-footer.component';

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
  imports: [AuthFooterComponent, BrandLogo, ThemeToggle],
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
}
