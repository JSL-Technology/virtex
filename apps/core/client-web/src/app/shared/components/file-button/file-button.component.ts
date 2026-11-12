import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { LucideAngularModule, Upload } from 'lucide-angular';

/**
 * Elegir un archivo: un botón secundario que abre el selector del sistema.
 *
 * ## Por qué un componente
 *
 * La misma acción tenía tres formas en Configuración —un icono sobre la foto de perfil, un botón
 * «Subir logo» y el control nativo «Elegir archivo»— y en dos de ellas el foco del teclado caía en un
 * `<input type="file">` invisible sin que el botón lo mostrara. Aquí el campo sigue siendo el control
 * real (accesible, con su diálogo nativo), y el botón que se ve dibuja el anillo de foco cuando el
 * campo lo tiene.
 */
@Component({
  selector: 'vx-file-button',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="fb" [class.fb--disabled]="disabled()" [class.fb--busy]="busy()">
      <lucide-icon [img]="icon()" size="16" aria-hidden="true"></lucide-icon>
      <span>{{ labelKey() | translate }}</span>
      <input
        #field
        type="file"
        class="fb__input"
        [attr.id]="inputId()"
        [accept]="accept()"
        [disabled]="disabled() || busy()"
        [attr.aria-describedby]="describedBy()"
        (change)="pick(field)"
      />
    </label>
  `,
  styleUrl: './file-button.component.scss',
})
export class VxFileButtonComponent {
  readonly labelKey = input.required<string>();
  readonly accept = input('');
  readonly disabled = input(false);
  /** Mientras se sube: el botón no admite otro archivo. */
  readonly busy = input(false);
  readonly inputId = input<string | null>(null);
  readonly describedBy = input<string | null>(null);
  readonly icon = input<unknown>(Upload);
  readonly fileSelected = output<File>();

  protected pick(field: HTMLInputElement): void {
    const file = field.files?.[0];
    if (file) this.fileSelected.emit(file);
    // Permite volver a elegir el mismo archivo después de un error.
    field.value = '';
  }
}
