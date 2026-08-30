import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

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
  @Output() clicked = new EventEmitter<void>();
}
