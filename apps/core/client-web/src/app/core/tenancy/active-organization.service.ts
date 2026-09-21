import { Injectable, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationSkipped } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';

import { AuthService } from '../services/auth';
import { Organization } from '../../shared/interfaces/user.interface';

/** El prefijo de toda ruta autenticada: `/e/{empresa}/...`. */
export const ORGANIZATION_SEGMENT = 'e';

/**
 * La última empresa que esta persona usó EN ESTE NAVEGADOR.
 *
 * Es una comodidad por visor, no un dato del producto: se guarda en `localStorage` para que
 * iniciar sesión te deje donde estabas, y si no está —navegador nuevo, datos borrados, ventana
 * privada— se cae al orden normal sin que nada falle. Deliberadamente NO viaja al servidor: la
 * empresa en la que alguien trabaja hoy no es una preferencia de la cuenta, y hacerla global
 * significaría que abrir el producto en el portátil cambia dónde aterriza el móvil.
 */
const LAST_ORGANIZATION_KEY = 'erp_last_organization';

/**
 * La empresa en la que está esta ventana, leída de la URL.
 *
 * ## Por qué la empresa vive en la ruta
 *
 * Vivía solo en el token de acceso, y cambiarla emitía tokens nuevos. El token lo comparten todas
 * las pestañas del navegador, así que cambiar de empresa en una cambiaba en silencio la empresa en
 * la que escribían las demás: una pestaña mostrando los libros de A y posteando en los de B. En un
 * ERP eso no es una incomodidad de interfaz, es un asiento en el libro equivocado.
 *
 * En la ruta, la empresa es parte de la identidad de la pantalla —que es lo que ya era
 * conceptualmente—, dos pestañas son dos empresas sin interferirse, y un enlace que alguien pega
 * en un correo lleva la empresa consigo en vez de abrirse en la que el receptor tuviera activa.
 *
 * ## Una sola forma de construir una URL
 *
 * `urlFor()` es el único sitio que sabe que las rutas llevan prefijo. El manifiesto de módulos
 * sigue declarando `/accounting/journal-entries` —la empresa no es parte de la identidad de la
 * PÁGINA— y este servicio la añade. Si cada plantilla lo hiciera por su cuenta, la primera que se
 * olvidara enviaría a alguien a la empresa equivocada sin que nada fallara.
 */
@Injectable({ providedIn: 'root' })
export class ActiveOrganizationService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  /**
   * La URL actual, como señal.
   *
   * `NavigationSkipped` cuenta además de `NavigationEnd`: navegar a la URL en la que ya estás no
   * emite `NavigationEnd`, y sin eso la primera lectura tras un `skipLocationChange` se queda con
   * el valor anterior.
   */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd || e instanceof NavigationSkipped),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** El segmento de empresa de la URL, o null si la URL no lo lleva (login, pago, raíz). */
  readonly slug = computed<string | null>(() => slugFromUrl(this.url()));

  /** Todas las empresas en las que esta persona puede actuar. Siempre incluye la activa. */
  readonly available = computed<Organization[]>(() => this.auth.currentUser()?.organizations ?? []);

  /**
   * La empresa activa: la de la URL si se reconoce, y si no la del principal.
   *
   * El respaldo importa durante el arranque: el principal llega antes de que el router haya
   * resuelto la primera navegación, y la barra de estado no debería quedarse vacía un instante.
   */
  readonly organization = computed<Organization | null>(() => {
    const slug = this.slug();
    const fromUrl = slug ? this.available().find((o) => o.slug === slug) : undefined;
    return fromUrl ?? this.auth.currentUser()?.organization ?? null;
  });

  /** ¿Pertenece esta persona a la empresa que pide la URL? */
  readonly isSlugAccessible = computed<boolean>(() => {
    const slug = this.slug();
    if (!slug) return false;
    return this.available().some((o) => o.slug === slug);
  });

  /**
   * La URL de una ruta del manifiesto, dentro de la empresa activa.
   *
   * Acepta rutas con o sin barra inicial y no duplica el prefijo si ya lo lleva, porque los dos
   * casos aparecen: el manifiesto declara `/invoices`, y una redirección puede traer ya
   * `/e/nortex/invoices`.
   */
  urlFor(path: string, slug: string | null = this.slug()): string {
    const clean = path.startsWith('/') ? path : `/${path}`;
    if (slugFromUrl(clean)) return clean;
    if (!slug) return clean;
    return `/${ORGANIZATION_SEGMENT}/${slug}${clean === '/' ? '' : clean}`;
  }

  /** La misma página, en otra empresa. Lo que hace el selector de empresa. */
  urlInOrganization(slug: string): string {
    return this.urlFor(pathWithoutOrganization(this.url()), slug);
  }

  /**
   * Anota en qué empresa se está trabajando, para volver aquí en la próxima sesión.
   *
   * Envuelto en try/catch porque `localStorage` lanza en una ventana privada y con los datos de
   * sitio bloqueados, y no poder recordar la última empresa no es motivo para romper una
   * navegación.
   */
  remember(slug: string): void {
    try {
      localStorage.setItem(LAST_ORGANIZATION_KEY, slug);
    } catch {
      /* sin memoria: se cae al orden normal */
    }
  }

  /** La última empresa usada, si sigue siendo accesible. */
  lastUsed(): string | null {
    try {
      const slug = localStorage.getItem(LAST_ORGANIZATION_KEY);
      // Comprobado contra la pertenencia ACTUAL: a alguien se le puede haber retirado el acceso
      // desde la última vez, y llevarlo a una empresa que ya no es suya sería mandarlo a una
      // pantalla que responde 403 a todo.
      return slug && this.available().some((o) => o.slug === slug) ? slug : null;
    } catch {
      return null;
    }
  }
}

/** El slug de una URL `/e/{slug}/...`, o null. Función libre: la usan el guard y las pruebas. */
export function slugFromUrl(url: string): string | null {
  const segments = url.split('?')[0].split('#')[0].split('/').filter(Boolean);
  if (segments[0] !== ORGANIZATION_SEGMENT) return null;
  return segments[1] ? decodeURIComponent(segments[1]) : null;
}

/**
 * La ruta sin el prefijo de empresa: `/e/nortex/invoices` → `/invoices`.
 *
 * Es la forma en la que el manifiesto, las pestañas y el espacio de trabajo hablan de una página.
 * Una pestaña es «la lista de facturas», no «la lista de facturas de Nortex»: la empresa la pone
 * la ventana, y guardar la pestaña con la empresa dentro haría que restaurar un espacio de trabajo
 * arrastrara a la empresa en la que se guardó.
 */
export function pathWithoutOrganization(url: string): string {
  const [pathAndQuery] = [url];
  const hashIndex = pathAndQuery.indexOf('#');
  const withoutHash = hashIndex >= 0 ? pathAndQuery.slice(0, hashIndex) : pathAndQuery;
  const [path, query] = withoutHash.split('?');
  const segments = path.split('/').filter(Boolean);
  if (segments[0] !== ORGANIZATION_SEGMENT) return withoutHash;
  const rest = segments.slice(2);
  const base = rest.length ? `/${rest.join('/')}` : '/';
  return query ? `${base}?${query}` : base;
}
