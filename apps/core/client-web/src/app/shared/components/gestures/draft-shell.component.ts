import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { Subscription, merge } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, ArrowLeft, AlertTriangle, Check, Loader } from 'lucide-angular';

/** Un fallo de validación, con el campo al que pertenece. */
export interface DraftProblem {
  /** Clave i18n del mensaje, o un mensaje ya localizado que venga del servidor. */
  message: string;
  /** Parámetros de interpolación del mensaje: el nombre del campo, un mínimo, una longitud. */
  params?: Record<string, unknown>;
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

  private readonly translate = inject(TranslateService);

  /** Errores a mostrar arriba. Vacío mientras el usuario no haya intentado guardar. */
  readonly problems = input<DraftProblem[]>([]);

  /**
   * El formulario, para que el resumen se vacíe solo a medida que se corrigen los campos.
   *
   * Opcional, pero es la diferencia entre un resumen y una acusación: la página llena `problems`
   * al fallar el guardado y nadie los volvía a mirar, así que «"Cliente" es obligatorio» seguía en
   * pantalla con el cliente ya elegido. Quien lee eso deja de fiarse del resumen entero, que es
   * precisamente lo que este gesto existe para evitar.
   *
   * Se PODA, no se recalcula: una línea desaparece cuando su campo pasa a ser válido, pero no
   * aparecen líneas nuevas mientras se teclea. Un resumen que crece mientras escribes es un
   * formulario que te regaña por no haber terminado.
   */
  readonly form = input<AbstractControl | null>(null);

  /** Se incrementa con cada cambio de validez del formulario, para reevaluar la poda. */
  private readonly formRevision = signal(0);

  constructor() {
    let subscription: Subscription | null = null;
    effect((onCleanup) => {
      const group = this.form();
      subscription?.unsubscribe();
      subscription = null;
      if (!group) return;

      //  `valueChanges` y `statusChanges`: el primero cubre el caso normal —se escribe y el campo
      //  pasa a válido—, el segundo los validadores asíncronos, que resuelven después.
      subscription = merge(group.valueChanges, group.statusChanges).subscribe(() =>
        this.formRevision.update((revision) => revision + 1),
      );
      onCleanup(() => subscription?.unsubscribe());
    });
  }

  /**
   * Los problemas que todavía lo son.
   *
   * Un problema sin `fieldId`, o cuyo control ya no existe, se conserva: puede venir del servidor
   * o de una regla que no pertenece a un solo campo, y esconderlo sería peor que dejarlo.
   */
  private readonly livingProblems = computed(() => {
    this.formRevision();
    const group = this.form();
    const declared = this.problems();
    if (!group) return declared;
    return declared.filter((problem) => {
      if (!problem.fieldId) return true;
      const control = group.get(problem.fieldId);
      return control ? control.invalid : true;
    });
  });

  /**
   * Los mismos problemas, con el rótulo del campo ya traducido.
   *
   * `draftProblems` recoge CLAVES i18n —la misma que usa el `<label>` del campo— y las deja en
   * `params.field` para que las traduzca el armazón. No las traducía nadie: la plantilla pasaba el
   * parámetro tal cual al pipe, que solo traduce el mensaje, así que el resumen de errores decía
   * «"CONTACTS.CUSTOMER_FORM.NOMBRE_EMPRESA" es obligatorio» en todos los formularios que usan
   * este gesto. Un control sin clave declarada conserva su propio nombre: `instant` devuelve la
   * cadena intacta cuando no es una clave conocida, que es justo el comportamiento que la función
   * documenta como deliberado.
   */
  protected readonly resolvedProblems = computed(() =>
    this.livingProblems().map((problem) => {
      const field = problem.params?.['field'];
      if (typeof field !== 'string') return problem;
      return { ...problem, params: { ...problem.params, field: this.translate.instant(field) } };
    }),
  );

  /** Error de servidor al guardar, ya localizado. */
  readonly error = input<string | null>(null);

  readonly saveLabelKey = input('COMMON.SAVE');
  readonly cancelLabelKey = input('COMMON.CANCEL');

  readonly save = output<void>();
  /**
   * Abandoning the draft.
   *
   * Named `cancelled` and not `cancel`: `cancel` IS a DOM event — a `<dialog>` dismissed with
   * Escape and a file picker closed with no selection both fire one, and it bubbles. A page
   * binding `(cancel)` on the shell would have been called by a native event from any such element
   * inside it, and would have thrown the user's draft away because they closed a file dialog.
   */
  readonly cancelled = output<void>();
  /**
   * El resumen pide el foco para un campo.
   *
   * El armazón ya intenta encontrarlo él mismo (ver `focusProblem`), así que la página solo escucha
   * esto cuando necesita hacer algo más — abrir la pestaña que contiene el campo, por ejemplo.
   */
  readonly focusField = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

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
   * Un envío ya salió y todavía no se sabe en qué quedó.
   *
   * `saving` llega como `input`, y un `input` se propaga en la detección de cambios, no en el acto.
   * Tres clics dentro de la MISMA tarea —un doble clic rápido, un ratón que rebota, un script—
   * ocurren todos antes de que la página pueda decir «estoy guardando», así que los tres veían
   * `saving() === false` y los tres salían. Medido: tres peticiones, dos respondidas «ya existe un
   * registro con esos datos» sobre el registro que el propio usuario acababa de crear.
   *
   * Este pestillo se echa en el mismo instante del envío, sin esperar a nadie.
   */
  private readonly submitted = signal(false);

  /**
   * El botón de guardar NO se deshabilita cuando el formulario es inválido.
   *
   * Un botón gris no dice qué falta: el usuario repasa el formulario buscando el campo culpable,
   * que suele estar fuera de la pantalla. Pulsar y recibir el resumen —con enlaces a los campos—
   * responde la pregunta en un clic. Solo se bloquea mientras se guarda, que es lo único que un
   * segundo clic puede estropear de verdad.
   */
  protected readonly canSubmit = computed(() => !this.saving() && !this.submitted());

  /**
   * Llevar el foco al campo que el resumen nombra.
   *
   * Lo hace el armazón y no cada página porque es la misma búsqueda diecinueve veces, y porque una
   * página que se olvidara de conectarlo dejaría un enlace que no hace nada — peor que no ofrecerlo.
   *
   * Dos formas de encontrarlo, en orden: por `id`, y si no, por `formControlName`. La segunda
   * cubre los formularios escritos como `<label><span>…</span><input formControlName="x"></label>`,
   * que no ponen `id` porque la asociación es implícita. Del identificador de un control anidado
   * —`lines.1.price`— se usa el último segmento, que es como se llama el control dentro de su fila.
   */
  protected focusProblem(fieldId: string): void {
    this.focusField.emit(fieldId);

    const root = this.host.nativeElement;
    const leaf = fieldId.split('.').pop() ?? fieldId;
    //  Comparación por propiedad en vez de un selector construido con el identificador: un `id`
    //  con un punto —`lines.1.price`— no es un selector válido, y `CSS.escape` no existe en todos
    //  los entornos.
    const byId = Array.from(root.querySelectorAll<HTMLElement>('[id]')).find(
      (element) => element.id === fieldId,
    );
    const byControl = Array.from(
      root.querySelectorAll<HTMLElement>('[formControlName]'),
    ).find((element) => element.getAttribute('formControlName') === leaf);
    const target = byId ?? byControl;

    if (!target) return;
    //  `scrollIntoView` no existe en todos los entornos —jsdom entre ellos— y una excepción aquí
    //  se llevaría por delante el foco, que es lo único que de verdad importa de este método.
    target.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    target.focus();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;

    this.submitted.set(true);
    this.save.emit();

    //  Se suelta tras el siguiente renderizado, que es cuando ya se sabe qué hizo la página: si
    //  arrancó una petición, `saving` ya vale `true` y mantiene el botón bloqueado; si rechazó el
    //  formulario, el botón tiene que volver a funcionar. Dejar el pestillo echado más tiempo
    //  convertiría un fallo de validación en un formulario que no se puede reenviar.
    afterNextRender(() => this.submitted.set(false), { injector: this.injector });
  }
}
