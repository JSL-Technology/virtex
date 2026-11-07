import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CircleAlert, CircleCheck, Info, LucideAngularModule, TriangleAlert } from 'lucide-angular';

export type VxNoticeTone = 'info' | 'warning' | 'danger' | 'success';

/**
 * Un aviso dentro de una página: una explicación, un requisito, una consecuencia o un resultado.
 *
 * ## Por qué un componente
 *
 * El mismo tipo de aviso se pintaba de cuatro maneras: banda amarilla, caja gris con título naranja,
 * franja verde con borde izquierdo y texto plano. Un requisito llegó a mostrarse en verde de éxito.
 * El tono se elige por lo que el aviso significa —no por cómo se quiere que se vea— y el componente
 * decide cómo se pinta, con los tokens del tema, el mismo icono para el mismo tono y un rol accesible
 * coherente.
 *
 * - `info`: explica o pide un requisito.
 * - `warning`: una consecuencia que conviene atender.
 * - `danger`: algo bloquea o falló.
 * - `success`: algo quedó hecho y vigente.
 */
@Component({
  selector: 'vx-notice',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vx-notice',
    '[class.vx-notice--info]': "tone() === 'info'",
    '[class.vx-notice--warning]': "tone() === 'warning'",
    '[class.vx-notice--danger]': "tone() === 'danger'",
    '[class.vx-notice--success]': "tone() === 'success'",
    '[attr.role]': "live() ? 'status' : 'note'",
  },
  template: `
    <lucide-icon [img]="icon()" size="18" class="vx-notice__icon" aria-hidden="true"></lucide-icon>
    <div class="vx-notice__body"><ng-content /></div>
  `,
  styleUrl: './notice.component.scss',
})
export class VxNoticeComponent {
  readonly tone = input<VxNoticeTone>('info');
  /** Anunciarlo al aparecer (un resultado que llega); por defecto es una nota estática. */
  readonly live = input(false);

  protected readonly icon = computed(() => {
    switch (this.tone()) {
      case 'warning':
        return TriangleAlert;
      case 'danger':
        return CircleAlert;
      case 'success':
        return CircleCheck;
      default:
        return Info;
    }
  });
}
