import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, ArrowLeft, AlertTriangle, Check, Loader } from 'lucide-angular';

/** Un fallo de validación, con el campo al que pertenece. */
export interface DraftProblem {
  /** Clave i18n del mensaje, o un mensaje ya localizado que venga del servidor. */
  message: string;
  /** `id` del control, para que el resumen lleve el foco al campo. Opcional. */
  fieldId?: string;
}

/**
 * El gesto DRAFT: cambiar un borrador y confirmarlo.
 *
 * ## Por qué el estado de guardado va arriba y siempre
 *
 * Es el gesto donde se pierde trabajo. Un formulario que no dice si hay cambios sin guardar deja
 * esa cuenta al usuario, y la respuesta que se da a sí mismo —«creo que sí lo guardé»— es la que
 * produce la llamada a soporte. El indicador es una frase, no un punto de color: «Sin guardar» se
 * lee, un punto naranja hay que aprenderlo.
 *
 * ## Por qué las acciones están arriba y no al final del formulario
 *
 * Un asiento contable de cuarenta líneas o una factura con veinte conceptos empujan el botón de
 * guardar fuera de la pantalla, y entonces guardar exige desplazarse hasta el final —justo cuando
 * lo que se acaba de tocar está arriba—. Fijas en el encabezado están donde se necesitan y no se
 * mueven.
 *
 * ## Por qué hay un resumen de errores y no solo mensajes bajo cada campo
 *
 * El mensaje bajo el campo es imprescindible y no basta: si el campo inválido está fuera de la
 * vista, el formulario simplemente «no guarda» y no dice por qué. El resumen los reúne arriba y
 * cada línea lleva al campo. Es también lo que un lector de pantalla anuncia al fallar el envío.
 */
@Component({
  selector: 'vx-draft-shell',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './draft-shell.component.html',
  styleUrls: ['./draft-shell.component.scss'],
})
export class DraftShellComponent {
  /** Nombre del borrador, ya compuesto: `Nueva factura`, `Editar producto — Tornillo M6`. */
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);

  /** Hay cambios sin guardar. */
  readonly dirty = input(false);
  /** Guardando ahora mismo. Deshabilita el envío para que un doble clic no cree dos registros. */
  readonly saving = input(false);
  /** El formulario no cumple sus reglas. El botón sigue habilitado a propósito: ver abajo. */
  readonly invalid = input(false);

  /** Errores a mostrar arriba. Vacío mientras el usuario no haya intentado guardar. */
  readonly problems = input<DraftProblem[]>([]);

  /** Error de servidor al guardar, ya localizado. */
  readonly error = input<string | null>(null);

  readonly saveLabelKey = input('COMMON.SAVE');
  readonly cancelLabelKey = input('COMMON.CANCEL');

  readonly save = output<void>();
  readonly cancel = output<void>();
  /** El resumen pide el foco para un campo. La página sabe dónde está. */
  readonly focusField = output<string>();

  protected readonly BackIcon = ArrowLeft;
  protected readonly AlertIcon = AlertTriangle;
  protected readonly CheckIcon = Check;
  protected readonly SavingIcon = Loader;

  /**
   * Qué dice el indicador de estado.
   *
   * `saved` solo después de haber estado sucio: decir «Guardado» a un formulario recién abierto
   * que nadie ha tocado es una afirmación vacía que enseña al usuario a no leer el indicador.
   */
  protected readonly status = computed<'saving' | 'dirty' | 'clean'>(() => {
    if (this.saving()) return 'saving';
    if (this.dirty()) return 'dirty';
    return 'clean';
  });

  /**
   * El botón de guardar NO se deshabilita cuando el formulario es inválido.
   *
   * Un botón gris no dice qué falta: el usuario repasa el formulario buscando el campo culpable,
   * que suele estar fuera de la pantalla. Pulsar y recibir el resumen —con enlaces a los campos—
   * responde la pregunta en un clic. Solo se bloquea mientras se guarda, que es lo único que un
   * segundo clic puede estropear de verdad.
   */
  protected readonly canSubmit = computed(() => !this.saving());

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (this.canSubmit()) this.save.emit();
  }
}
