import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Composición del logotipo. */
export type BrandLogoVariant = 'mark' | 'horizontal' | 'stacked';

/**
 * Logotipo de Virtex.
 *
 * ── Por qué un componente y no un `<img>` ───────────────────────────────────
 * La marca aparece sobre lienzos de luminosidad opuesta: la aurora casi negra
 * de las pantallas de acceso y la superficie clara de la aplicación. Un PNG o
 * un `<img src="logo.svg">` no puede resolver eso — el navegador no aplica las
 * custom properties del documento al contenido de un SVG cargado como imagen —
 * y obliga a mantener dos archivos y a acertar cuál toca en cada sitio.
 *
 * Con el SVG en línea el asta oscura de la «V» es `var(--content-primary)`, de
 * modo que se vuelve casi blanca en tema oscuro y azul marino en claro sin una
 * sola línea de lógica. El asta azul es `var(--accent-solid)`, el mismo token
 * que el servicio de marca sobrescribe: una organización con color propio ve el
 * logotipo en SU azul, algo imposible con un archivo estático.
 *
 * Quedan además los `.svg` de `assets/logos/` para lo que sale del navegador
 * —favicon, plantillas de correo, PDF—, donde no hay tema al que responder.
 *
 * ── Geometría ───────────────────────────────────────────────────────────────
 * Dos astas rectas de grosor constante. La izquierda, azul, lleva el vértice y
 * remata en esquina redondeada arriba a la izquierda y abajo a la derecha. La
 * derecha, oscura, muere en un bisel PARALELO al canto interior del asta azul:
 * ese corte es lo que hace que las dos piezas se lean como una sola letra y no
 * como dos barras cruzadas.
 */
@Component({
  selector: 'app-brand-logo',
  standalone: true,
  templateUrl: './brand-logo.html',
  styleUrls: ['./brand-logo.scss'],
  host: {
    '[class]': '"brand-logo brand-logo--" + variant',
    '[style.--brand-mark-size.px]': 'size',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandLogo {
  /** `mark` solo el símbolo · `horizontal` símbolo + texto · `stacked` texto debajo. */
  @Input() variant: BrandLogoVariant = 'horizontal';

  /** Altura del símbolo en píxeles. El texto se dimensiona en proporción. */
  @Input() size = 32;

  /** Bajada «ERP». Se oculta en tamaños pequeños, donde no llega a leerse. */
  @Input() showTagline = true;

  /**
   * Fuerza toda la marca al color del texto en curso. Necesario cuando el
   * logotipo va dentro de una superficie de acento —un botón azul, una insignia
   * de color— donde el asta azul de marca se perdería contra el fondo.
   */
  @Input() monochrome = false;

  /**
   * Texto que anuncia un lector de pantalla. El SVG es decorativo: quien lee la
   * página oye este nombre una sola vez, no «gráfico» seguido de dos trazados.
   */
  @Input() label = 'Virtex ERP';
}
