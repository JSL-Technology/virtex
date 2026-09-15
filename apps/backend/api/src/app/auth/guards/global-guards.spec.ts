import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Los guards globales son globales, y nadie los vuelve a declarar.
 *
 * ## Qué protege esta prueba
 *
 * `JwtAuthGuard` y `CsrfGuard` están registrados en `AppModule` como `APP_GUARD`, así que corren en
 * **todas** las rutas de la aplicación. Aun así, 103 controladores repetían `@UseGuards(JwtAuthGuard)`
 * y 41 `@UseGuards(CsrfGuard)`, lo que ejecutaba cada guard dos veces por petición y —peor— hacía
 * que el código leyera como si la autenticación fuese opt-in.
 *
 * Esa lectura es exactamente la trampa que este repositorio ya documentó tres veces: un control que
 * hay que acordarse de declarar es un control que falta. `PermissionsGuard` llegó a 47 de 76
 * controladores mientras era opt-in; CSRF a 4 de 50; la comprobación de suscripción a 1 de 67.
 *
 * Al quitar las declaraciones redundantes, el registro global pasa a ser lo único que protege las
 * rutas. Esta prueba es lo que impide que desaparezca en silencio, y lo que impide que alguien
 * vuelva a añadir la declaración por controlador pensando que hacía falta.
 *
 * ## Por qué lee el código fuente
 *
 * Levantar el contenedor de Nest necesita base de datos, Redis y un entorno completo, lo que saca
 * esta comprobación de la suite rápida. Leer el árbol corre en milisegundos, que es lo que la
 * convierte en un gate y no en un nocturno — el mismo criterio que `module-graph.spec.ts`.
 */
describe('los guards globales', () => {
  const APP_ROOT = join(__dirname, '..', '..');

  const filesUnder = (dir: string, suffix: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return filesUnder(full, suffix);
      return full.endsWith(suffix) ? [full] : [];
    });

  /** Comentarios fuera: un docstring que cita el antipatrón no es una declaración. */
  const withoutComments = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, '');

  const appModule = withoutComments(readFileSync(join(APP_ROOT, 'app.module.ts'), 'utf8'));

  /** Los que corren en todas las rutas y por lo tanto nadie debe volver a declarar. */
  const GLOBAL_GUARDS = ['JwtAuthGuard', 'CsrfGuard'] as const;

  describe.each(GLOBAL_GUARDS)('%s', (guard) => {
    it('está registrado como APP_GUARD en AppModule', () => {
      // `{ provide: APP_GUARD, useClass: X }` — con lo que haya en medio (comentarios ya fuera).
      const registration = new RegExp(
        String.raw`provide:\s*APP_GUARD\s*,\s*useClass:\s*${guard}\s*,?`,
      );
      expect(appModule).toMatch(registration);
    });

    it('no se vuelve a declarar en ningún @UseGuards', () => {
      const offenders = filesUnder(APP_ROOT, '.ts')
        .filter((f) => !f.endsWith('.spec.ts'))
        .flatMap((file) => {
          const source = withoutComments(readFileSync(file, 'utf8'));
          return [...source.matchAll(/@UseGuards\(([^)]*)\)/g)]
            .filter((m) => m[1].split(',').some((g) => g.trim() === guard))
            .map(() => file.slice(APP_ROOT.length + 1));
        });

      expect(offenders).toEqual([]);
    });
  });

  /**
   * El orden importa y está documentado en `AppModule`: CSRF y los permisos leen `request.user`,
   * que solo existe después de que corra `JwtAuthGuard`. Nest ejecuta los `APP_GUARD` en el orden
   * en que se declaran, así que el orden del archivo ES la configuración.
   */
  it('autentica antes de comprobar CSRF, permisos y suscripción', () => {
    const order = ['JwtAuthGuard', 'CsrfGuard', 'PermissionsGuard', 'SubscriptionActiveGuard'];
    const positions = order.map((guard) => ({
      guard,
      at: appModule.indexOf(`useClass: ${guard}`),
    }));

    // Nombrado, no por índice: un -1 suelto no dice cuál de los cuatro falta.
    expect(positions.filter((p) => p.at === -1).map((p) => p.guard)).toEqual([]);
    expect(positions.map((p) => p.at)).toEqual([...positions.map((p) => p.at)].sort((a, b) => a - b));
  });
});
