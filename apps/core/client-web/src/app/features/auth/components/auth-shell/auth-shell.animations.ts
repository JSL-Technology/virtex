import { animate, group, query, style, transition, trigger } from '@angular/animations';

/**
 * Transición entre pantallas de acceso dentro del armazón persistente.
 *
 * El armazón —lienzo de aurora, lámina de cristal y pie— no se desmonta al
 * navegar entre acceso, recuperación o alta: solo cambia lo que hay DENTRO de la
 * lámina. Esta transición es la que hace que ese cambio se sienta continuo.
 *
 * La pantalla saliente y la entrante se superponen (`position: absolute`) para
 * que el relevo ocurra en el mismo sitio, no en dos pasos: la saliente se
 * desvanece subiendo un poco y la entrante llega desde abajo con una curva de
 * desaceleración larga, la misma sensación «física» que la entrada de la lámina.
 */
export const authContentAnimation = trigger('authContent', [
  transition('* => *', [
    // La entrante parte invisible y ligeramente baja.
    query(':enter', [style({ opacity: 0, transform: 'translateY(10px)' })], {
      optional: true,
    }),
    // La saliente se saca del flujo para no empujar a la entrante.
    query(':leave', [style({ position: 'absolute', inset: 0 })], {
      optional: true,
    }),
    group([
      query(
        ':leave',
        [animate('150ms cubic-bezier(0.4, 0, 1, 1)', style({ opacity: 0, transform: 'translateY(-10px)' }))],
        { optional: true },
      ),
      query(
        ':enter',
        [animate('300ms 70ms cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 1, transform: 'translateY(0)' }))],
        { optional: true },
      ),
    ]),
  ]),
]);
