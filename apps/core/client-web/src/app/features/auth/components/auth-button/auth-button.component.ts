import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { NgClass } from '@angular/common';

/**
 * Botón de acción de las pantallas públicas.
 *
 * La entrada `variant` existía desde el principio en el TypeScript, pero la
 * hoja de estilos pintaba SIEMPRE el botón principal: pedir `variant="ghost"`
 * devolvía un botón azul de acción primaria. Las pantallas que necesitaban una
 * acción secundaria terminaban escribiéndose su propio botón, y de ahí salieron
 * tres botones distintos para la misma jerarquía. Ahora cada variante tiene su
 * regla y la entrada significa lo que dice.
 */
@Component({
  selector: 'app-auth-button',
  standalone: true,
  imports: [NgClass],
  templateUrl: './auth-button.component.html',
  styleUrls: ['./auth-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthButtonComponent {
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() variant: 'primary' | 'secondary' | 'outline' | 'ghost' = 'primary';
  @Input() disabled = false;
  @Input() loading = false;

  /**
   * `size` se acepta y se ignora a propósito: varias plantillas ya lo pasaban
   * («lg», «md») cuando el componente no lo declaraba. Con `strictTemplates`
   * eso es un error de compilación, y el botón de acceso tiene un único tamaño
   * por decisión de diseño — es la acción principal de la pantalla.
   */
  @Input() size: 'md' | 'lg' = 'lg';

  @Output() clicked = new EventEmitter<Event>();
}
