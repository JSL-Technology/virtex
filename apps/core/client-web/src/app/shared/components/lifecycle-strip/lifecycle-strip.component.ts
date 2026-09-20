import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { mainPath } from '@virteex/shared/types';
import { DocumentLifecycleService } from '../../../core/lifecycle/document-lifecycle.service';

/** Una etapa ya dibujada: dónde cae respecto de donde está el documento. */
interface StagePoint {
  status: string;
  labelKey: string;
  /** Ya ocurrió. */
  done: boolean;
  /** Es donde está ahora. */
  current: boolean;
}

/**
 * Dónde está un documento y qué le queda.
 *
 * ## Qué problema resuelve
 *
 * Una insignia dice «Enviada» y nada más. No dice que antes hubo una aprobación, ni que lo
 * siguiente es recibir, ni que desde aquí ya no se pueden cambiar los términos. Quien usa el
 * producto por primera vez —que en una PyME es casi siempre— tiene que aprenderse el recorrido
 * fuera de la pantalla, normalmente preguntando.
 *
 * La tira lo enseña: el camino completo, con lo hecho detrás y lo que falta delante.
 *
 * ## Por qué no dibuja las etapas excepcionales
 *
 * Porque «rechazada» y «cancelada» no son pasos del camino. Ponerlas en la línea sugiere que se
 * pasa por ellas, y la tira dejaría de responder a la pregunta que contesta —«¿qué se espera que
 * pase ahora?»—. Cuando el documento ESTÁ en una de ellas sí se muestra, al final y marcada, que
 * es el único momento en que es cierta.
 *
 * ## Por qué no dibuja nada si no hay declaración
 *
 * La mayoría de los documentos del producto todavía no declaran su vida. Inventarles un recorrido
 * —«borrador, emitida, pagada», que suena bien y no es lo que hace el servidor— sería enseñar una
 * regla falsa con toda la autoridad de la interfaz.
 */
@Component({
  selector: 'vx-lifecycle-strip',
  standalone: true,
  imports: [TranslateModule],
  templateUrl: './lifecycle-strip.component.html',
  styleUrls: ['./lifecycle-strip.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VxLifecycleStripComponent {
  private readonly lifecycles = inject(DocumentLifecycleService);

  /** El tipo tal como lo nombra el servidor: `purchase-order`, `purchase-requisition`. */
  readonly documentType = input.required<string>();

  /** El estado actual, como viene de la API. */
  readonly status = input.required<string>();

  constructor() {
    void this.lifecycles.load();
  }

  private readonly lifecycle = computed(() =>
    this.lifecycles.lifecycles().get(this.documentType()) ?? null,
  );

  /** El nombre del documento, para que un lector de pantalla sepa de qué recorrido se habla. */
  readonly documentLabelKey = computed(() => this.lifecycle()?.labelKey ?? '');

  readonly stages = computed<StagePoint[]>(() => {
    const lifecycle = this.lifecycle();
    if (!lifecycle) return [];

    const actual = this.status();
    const camino = mainPath(lifecycle);
    const porEstado = new Map(lifecycle.stages.map((s) => [s.status, s]));

    // El documento está en una etapa excepcional: se enseña el camino tal cual, con la
    // excepcional añadida al final. Marcar «hecho» hasta donde llegó sería adivinar: desde
    // «cancelada» no se sabe por dónde pasó antes.
    const excepcional = porEstado.get(actual)?.exceptional === true;
    const posicion = camino.indexOf(actual);

    const puntos: StagePoint[] = camino.map((status, indice) => ({
      status,
      labelKey: porEstado.get(status)?.labelKey ?? status,
      done: !excepcional && posicion >= 0 && indice < posicion,
      current: !excepcional && status === actual,
    }));

    if (excepcional) {
      puntos.push({
        status: actual,
        labelKey: porEstado.get(actual)?.labelKey ?? actual,
        done: false,
        current: true,
      });
    }
    return puntos;
  });

  /** Una tira de una sola etapa no informa de nada; dos ya son un recorrido. */
  readonly visible = computed(() => this.stages().length > 1);

  protected readonly excepcionalAlFinal = computed(() => {
    const lifecycle = this.lifecycle();
    return lifecycle?.stages.find((s) => s.status === this.status())?.exceptional === true;
  });
}
