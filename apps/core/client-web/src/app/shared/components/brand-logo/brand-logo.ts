import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Composición del logotipo. */
export type BrandLogoVariant = 'mark' | 'horizontal' | 'stacked';

/**
 * Logotipo de Virtex.
 *
 * ── El símbolo ──────────────────────────────────────────────────────────────
 * Un bloque de esquinas blandas con UN SOLO vértice vivo, cortado por dos
 * canales paralelos en tres planos que ascienden hacia esa esquina. El plano
 * del vértice es la única pieza en color de marca.
 *
 * El símbolo anterior era una «V» junto a la palabra «virtex»: el logotipo
 * decía dos veces lo mismo, y la primera vez peor. Aquí el símbolo no repite
 * ninguna letra — nombra el concepto. Un vértice es el punto donde se
 * encuentran varios planos, que es exactamente lo que hace un ERP con las
 * áreas de una empresa; el plano pequeño de la esquina opuesta es su
 * contrapartida, el otro lado del asiento.
 *
 * ── Por qué un componente y no un `<img>` ───────────────────────────────────
 * La marca aparece sobre lienzos de luminosidad opuesta: la aurora casi negra
 * de las pantallas de acceso y la superficie clara de la aplicación. Un PNG o
 * un `<img src="logo.svg">` no puede resolver eso — el navegador no aplica las
 * custom properties del documento al contenido de un SVG cargado como imagen —
 * y obliga a mantener dos archivos y a acertar cuál toca en cada sitio.
 *
 * Con el SVG en línea los planos son `var(--content-primary)`, de modo que la
 * marca se vuelve casi blanca en tema oscuro y casi negra en claro sin una sola
 * línea de lógica. El vértice es `var(--accent-solid)`, el mismo token que
 * sobrescribe el servicio de marca: una organización con color propio ve el
 * logotipo en SU color, algo imposible con un archivo estático.
 *
 * Quedan además los `.svg` de `assets/logos/` para lo que sale del navegador
 * —favicon, plantillas de correo, PDF—, donde no hay tema al que responder.
 *
 * ── El wordmark ─────────────────────────────────────────────────────────────
 * Va en curvas, no en texto. Antes se componía con `<text font-family="Inter">`
 * y con el interletrado muy abierto: si Inter no había cargado —o directamente
 * no existía, como en un cliente de correo— la marca se dibujaba en Arial. Con
 * las curvas ya trazadas el logotipo es el mismo en todas partes.
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
  /** `mark` solo el símbolo · `horizontal` símbolo + palabra · `stacked` palabra debajo. */
  @Input() variant: BrandLogoVariant = 'horizontal';

  /** Lado del símbolo en píxeles. La palabra se dimensiona en proporción. */
  @Input() size = 32;

  /**
   * Muestra la bajada de categoría bajo la palabra.
   *
   * Va apagada por defecto porque «ERP» no es parte del nombre: el producto se
   * llama Virtex y es un ERP, igual que Figma es un editor de diseño y no se
   * llama «Figma Design». La bajada sirve donde la marca aún no se conoce —una
   * portada comercial, una firma de correo—, no en la barra de la aplicación,
   * donde solo añade ruido a cada pantalla.
   */
  @Input() showDescriptor = false;

  /** Texto de la bajada. Se traduce como categoría que es, no como marca. */
  @Input() descriptor = 'ERP';

  /**
   * Fuerza toda la marca al color del texto en curso. Necesario cuando el
   * logotipo va dentro de una superficie de acento —un botón de color, una
   * insignia— donde el vértice se perdería contra el fondo.
   */
  @Input() monochrome = false;

  /**
   * Texto que anuncia un lector de pantalla. El SVG es decorativo: quien lee la
   * página oye este nombre una sola vez, no «gráfico» seguido de dos trazados.
   */
  @Input() label = 'Virtex';
}
