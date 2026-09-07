import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, ArrowLeft, AlertTriangle, RotateCw, PanelRight } from 'lucide-angular';

/** Cómo se pinta el estado de un documento. Semántico, nunca decorativo. */
export type DocumentTone = 'neutral' | 'draft' | 'ok' | 'warning' | 'danger';

/**
 * El gesto DOCUMENT: leer un registro, con su estado y su historia.
 *
 * ## Por qué el estado va en el encabezado y no en una pestaña
 *
 * En un ERP «en qué estado está» condiciona todo lo demás que se puede hacer con el documento: una
 * factura emitida no se edita, un periodo cerrado no admite asientos. Enterarse de eso pulsando un
 * botón que devuelve un error es la forma más cara de preguntarlo. Va arriba, junto al nombre, y
 * está siempre.
 *
 * ## Por qué hay un panel lateral y no más pestañas
 *
 * Comentarios, adjuntos y trazabilidad se consultan MIENTRAS se lee el documento —«¿por qué está
 * así?»— y una pestaña obliga a abandonar lo que se está mirando para responderse. El panel se
 * pliega, y su estado es del usuario: quien no lo usa no lo paga en anchura.
 */
@Component({
  selector: 'vx-document-shell',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './document-shell.component.html',
  styleUrls: ['./document-shell.component.scss'],
})
export class DocumentShellComponent {
  /** Nombre del documento, ya compuesto: `Factura B0100000123`. No es una clave i18n. */
  readonly title = input.required<string>();
  /** Segunda línea: el cliente, el proveedor, la fecha. Ya compuesta. */
  readonly subtitle = input<string | null>(null);

  /** Clave i18n del estado — `INVOICES.STATUS.ISSUED` — y cómo pintarlo. */
  readonly statusKey = input<string | null>(null);
  readonly statusTone = input<DocumentTone>('neutral');

  readonly loading = input(false);
  /** Clave i18n o mensaje ya localizado; ver `ListShellComponent.error`. */
  readonly error = input<string | null>(null);

  /** Muestra la flecha de volver. Ausente cuando el documento es la ventana entera. */
  readonly backLabelKey = input<string | null>(null);

  /** El panel lateral solo aparece si la página proyecta algo en él. */
  readonly hasAside = input(false);
  readonly asideOpen = input(true);

  readonly back = output<void>();
  readonly reload = output<void>();
  readonly toggleAside = output<void>();

  /** Bloques del esqueleto de carga. Constante: la plantilla no crea un array por ciclo. */
  protected readonly SKELETON = [1, 2, 3, 4] as const;

  protected readonly BackIcon = ArrowLeft;
  protected readonly AlertIcon = AlertTriangle;
  protected readonly ReloadIcon = RotateCw;
  protected readonly AsideIcon = PanelRight;

  protected readonly state = computed<'loading' | 'error' | 'content'>(() => {
    if (this.loading()) return 'loading';
    if (this.error()) return 'error';
    return 'content';
  });
}
