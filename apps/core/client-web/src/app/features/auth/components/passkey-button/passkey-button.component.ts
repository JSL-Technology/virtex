import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';

/**
 * Acceso con llave de paso (WebAuthn).
 *
 * Es la vía de acceso más segura que ofrece el producto y por eso va la primera
 * de las alternativas, con más superficie que los proveedores externos: no es
 * un botón más de la fila, es una recomendación.
 */
@Component({
  selector: 'app-passkey-button',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './passkey-button.component.html',
  styleUrls: ['./passkey-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasskeyButtonComponent {
  @Input() loading = false;

  /**
   * Modo compacto: solo el icono, para alinearlo en la misma fila que los
   * proveedores externos. El nombre pasa al `aria-label`. Por defecto conserva
   * la tarjeta completa con título y subtítulo.
   */
  @Input() iconOnly = false;

  /**
   * In the compact form, also print a short name next to the icon (QA M-14). An icon alone — a
   * key — was a guess for anybody who has never used a passkey, which is most people.
   */
  @Input() showLabel = false;

  @Output() clicked = new EventEmitter<void>();
}
