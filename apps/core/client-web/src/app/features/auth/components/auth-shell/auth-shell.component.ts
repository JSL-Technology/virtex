import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';

import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';
import { authContentAnimation } from './auth-shell.animations';

/**
 * Armazón persistente de las pantallas de acceso.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Antes cada pantalla (acceso, recuperación, alta…) montaba su propia copia de
 * `app-auth-layout`. Navegar entre ellas destruía y reconstruía el lienzo de
 * aurora y la lámina de cristal: la tarjeta «parpadeaba» y su animación de
 * entrada se repetía en cada salto.
 *
 * Aquí el armazón se monta UNA vez y aloja un `router-outlet` dentro de la
 * lámina. Al navegar solo cambia el contenido del hueco —con una transición
 * suave—, mientras el fondo, la tarjeta y el pie permanecen intactos.
 *
 * El fondo es común a todas las pantallas precisamente por eso: si cambiara
 * entre acceso y recuperación, la «tarjeta que no cambia» cambiaría de piel.
 */
@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [RouterOutlet, AuthLayoutComponent],
  templateUrl: './auth-shell.component.html',
  styleUrls: ['./auth-shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [authContentAnimation],
})
export class AuthShellComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Fondo compartido por todas las puertas de entrada. */
  readonly backgroundImage =
    'assets/images/vibrant-liquid-wavy-background-3d-illustration-abstract-iridescent-fluid-render-neon-holographic-smooth-surface-with-colorful-interference-stylish-spectrum-flow-motion.jpg';

  /**
   * Ancho de la lámina. Lo decide la ruta hija activa (`data.authWidth`): el
   * alta es un asistente de dos columnas y pide la medida ancha; el resto va en
   * la compacta.
   */
  readonly width = signal<'compact' | 'wide'>('compact');

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.syncWidthFromRoute());
    this.syncWidthFromRoute();
  }

  private syncWidthFromRoute(): void {
    //  Se recorre el árbol de SNAPSHOTS (ya construido por el router antes de
    //  activar componentes), no el de `ActivatedRoute` observables: en el
    //  momento de construir este armazón, el `snapshot` de las rutas hijas aún
    //  no está poblado y leerlo revienta con «Cannot read … 'data'».
    let snapshot = this.route.snapshot;
    while (snapshot.firstChild) {
      snapshot = snapshot.firstChild;
    }
    this.width.set(snapshot.data?.['authWidth'] === 'wide' ? 'wide' : 'compact');
  }

  /**
   * Clave de la transición: el `path` de la ruta activa. Cambia en cada
   * navegación, que es lo que dispara el `* => *` del disparador `authContent`.
   */
  routeState(outlet: RouterOutlet): string {
    return outlet.isActivated ? outlet.activatedRoute.snapshot.routeConfig?.path ?? '' : '';
  }
}
