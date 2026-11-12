import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';

let nextGroupId = 0;

/**
 * Un grupo dentro de una página de Configuración: su título, una frase que dice qué decide, y el
 * contenido.
 *
 * ## Por qué un componente
 *
 * Cada página dibujaba sus grupos a su manera: seis estilos de título (de 13 a 17 px, en dos pesos),
 * cuatro tipos de tarjeta con sombras y radios distintos, y separaciones de 0 a 24 px entre grupos.
 * Ninguna de esas diferencias fue una decisión. Con el grupo como componente la anatomía es una sola
 * —título, descripción, contenido, separados por espacio y sin tarjeta— y una página nueva no puede
 * inventar otra, porque no tiene dónde ponerla.
 *
 * `level` 3 es el subgrupo dentro de un grupo: el mismo componente con el nivel de encabezado y el
 * tamaño siguientes, de modo que el nivel del documento coincide siempre con el visual.
 */
@Component({
  selector: 'vx-settings-group',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.vx-settings-group--sub]': 'level() === 3' },
  template: `
    <section class="sg" [attr.aria-labelledby]="hasTitle() ? headingId : null">
      @if (hasTitle()) {
        <div class="sg__head">
          <div class="sg__lead">
            @if (level() === 3) {
              <h3 class="sg__title sg__title--sub" [id]="headingId">{{ title() ?? (titleKey()! | translate: params()) }}</h3>
            } @else {
              <h2 class="sg__title" [id]="headingId">{{ title() ?? (titleKey()! | translate: params()) }}</h2>
            }
            @if (descriptionKey(); as description) {
              <p class="sg__desc">{{ description | translate: params() }}</p>
            }
            <ng-content select="[groupMeta]" />
          </div>
          <div class="sg__actions"><ng-content select="[groupActions]" /></div>
        </div>
      }
      <div class="sg__body"><ng-content /></div>
    </section>
  `,
  styleUrl: './settings-group.component.scss',
})
export class SettingsGroupComponent {
  /** El nombre del grupo, como clave del catálogo. */
  readonly titleKey = input<string | null>(null);
  /** El nombre ya traducido, cuando viene del servidor o se compone. Gana a `titleKey`. */
  readonly title = input<string | null>(null);
  /** Una frase: qué decide este grupo. */
  readonly descriptionKey = input<string | null>(null);
  readonly params = input<Record<string, unknown>>({});
  /** 2: grupo de la página. 3: subgrupo dentro de un grupo. */
  readonly level = input<2 | 3>(2);

  protected readonly headingId = `settings-group-${++nextGroupId}`;
  protected hasTitle(): boolean {
    return Boolean(this.title() || this.titleKey());
  }
}
