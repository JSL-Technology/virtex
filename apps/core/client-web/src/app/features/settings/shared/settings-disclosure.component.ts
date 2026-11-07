import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';

/**
 * Contenido secundario que se despliega: «Qué cubre el producto en DO», «Sesiones en este
 * dispositivo». Antes cada página usaba su propio triángulo («▾» en una, «▶» en otra) y su propio
 * alineado; ahora es un único control, sobre `<details>` nativo para conservar el teclado y el
 * lector de pantalla, con el mismo chevron girando en todas partes.
 */
@Component({
  selector: 'vx-settings-disclosure',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="sd" [open]="open()" (toggle)="open.set($any($event.target).open)">
      <summary class="sd__summary">
        <lucide-icon [img]="Chevron" size="16" class="sd__chevron" aria-hidden="true"></lucide-icon>
        <span>{{ summary() }}</span>
      </summary>
      <div class="sd__body"><ng-content /></div>
    </details>
  `,
  styleUrl: './settings-disclosure.component.scss',
})
export class SettingsDisclosureComponent {
  /** El texto del resumen, ya traducido. */
  readonly summary = input.required<string>();
  readonly open = model(false);
  protected readonly Chevron = ChevronRight;
}
