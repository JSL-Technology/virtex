import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** Composición del logotipo. */
export type BrandLogoVariant = 'mark' | 'horizontal' | 'stacked';

/**
 * Versión cromática. Cada una existe para un soporte concreto; no son gustos
 * intercambiables.
 *
 * · `brand`    Versión principal a todo color. Se usa siempre que el soporte
 *              admita color, sobre fondo claro u oscuro indistintamente.
 * · `mono`     Un solo violeta de marca, sin degradado. Para reproducciones a
 *              una tinta que sí admiten color: bordados, serigrafía, sellos.
 * · `negative` Todo en blanco. Para fotografías, superficies de acento y
 *              cualquier fondo con el que el violeta no contraste.
 * · `positive` Todo en la tinta en curso. Para impresión a una tinta negra,
 *              fax, documentos oficiales y grabados.
 */
export type BrandLogoTone = 'brand' | 'mono' | 'negative' | 'positive';

/**  Contador de instancias: cada degradado necesita un `id` propio. */
let instanceCounter = 0;

/**
 * Logotipo de Virtex.
 *
 * ── El símbolo ──────────────────────────────────────────────────────────────
 * Un bloque de esquinas blandas con UN SOLO vértice vivo, cortado por dos
 * canales paralelos en tres planos que ascienden hacia esa esquina.
 *
 * El símbolo anterior era una «V» junto a la palabra «virtex»: el logotipo
 * decía dos veces lo mismo, y la primera vez peor. Aquí el símbolo no repite
 * ninguna letra — nombra el concepto. Un vértice es el punto donde se
 * encuentran varios planos, que es exactamente lo que hace un ERP con las
 * áreas de una empresa; el plano pequeño de la esquina opuesta es su
 * contrapartida, el otro lado del asiento.
 *
 * ── Por qué el color es fijo y no un token de tema ──────────────────────────
 * Durante una versión el símbolo se pintó con `--content-primary` y
 * `--accent-solid`. Se veía correcto y era un error de marca por partida doble:
 *
 *   · Era casi todo tinta —negro sobre claro, blanco sobre oscuro—, así que no
 *     aportaba NINGÚN reconocimiento por color. Una marca que cambia de color
 *     con el tema no se recuerda por su color.
 *   · `--accent-solid` lo sobrescribe `BrandingService` cuando una organización
 *     elige su acento. El logotipo de Virtex se teñía del color del cliente.
 *
 * Ahora el símbolo usa `--brand-*`: valores fijos, idénticos en los dos temas,
 * que ese servicio no escribe. El cliente personaliza SU interfaz; la marca de
 * Virtex mantiene su presencia dentro de ella.
 *
 * La marca es de UN SOLO color. Un degradado corto del mismo violeta recorre
 * toda la figura en diagonal ascendente, de modo que el vértice se destaca por
 * la luz del propio degradado y no por un segundo tono. Las dos paradas se
 * mantienen dentro de la franja de luminancia que contrasta a la vez con un
 * lienzo claro y con uno casi negro: ese es el recorrido más largo posible sin
 * necesitar una variante por tema, y es lo que permite que exista UN solo
 * logotipo en color.
 *
 * ── Por qué un componente y no un `<img>` ───────────────────────────────────
 * Un `<img src="logo.svg">` obliga a mantener un archivo por versión y a
 * acertar cuál toca en cada sitio. Con el SVG en línea, `tone` conmuta entre
 * las cuatro versiones cromáticas sin cambiar de archivo, y el símbolo hereda
 * el tamaño del componente sin descuadrarse.
 *
 * Quedan además los `.svg` de `assets/logos/` para lo que sale del navegador
 * —favicon, plantillas de correo, PDF—, donde no hay CSS que aplicar.
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
    '[class]': '"brand-logo brand-logo--" + variant + " brand-logo--" + tone',
    '[style.--brand-mark-size.px]': 'size',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandLogo {
  /** `mark` solo el símbolo · `horizontal` símbolo + palabra · `stacked` palabra debajo. */
  @Input() variant: BrandLogoVariant = 'horizontal';

  /** Versión cromática. Ver `BrandLogoTone`. */
  @Input() tone: BrandLogoTone = 'brand';

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
   * Texto que anuncia un lector de pantalla. El SVG es decorativo: quien lee la
   * página oye este nombre una sola vez, no «gráfico» seguido de dos trazados.
   */
  @Input() label = 'Virtex';

  /** `id` del degradado, único por instancia. */
  protected readonly gradientId = `vx-brand-${(instanceCounter += 1)}`;

  /**
   * Relleno del símbolo. Va como atributo de presentación y no en la hoja de
   * estilos porque el `id` del degradado solo se conoce en tiempo de ejecución;
   * las versiones que no lo usan lo anulan desde CSS, que gana a un atributo.
   */
  protected get symbolFill(): string {
    return `url(#${this.gradientId})`;
  }
}
