import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * QA C-03: «Nuevo recibo» no hacía nada.
 *
 * Las páginas se montan dentro de pestañas (dockview), fuera del `router-outlet`, y reciben un
 * `ActivatedRoute` sintético que no sirve para resolver enlaces relativos. `routerLink="new"`
 * apuntaba así a la misma página y el botón quedaba muerto: no se podía registrar ningún cobro.
 * Toda navegación de una página de la aplicación tiene que ser absoluta.
 */
describe('Enlaces de router en las páginas montadas en pestañas', () => {
  const root = join(__dirname, 'features');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.html')) files.push(path);
    }
  };
  walk(root);

  it('no usa enlaces relativos (routerLink="new" o [routerLink]="[\'x\', …]")', () => {
    const offenders: string[] = [];
    for (const file of files) {
      // Las pantallas públicas de acceso las monta el router de verdad; ahí lo relativo funciona.
      if (/features[\\/](auth|public|legal)[\\/]/.test(file)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\brouterLink="(?![/{])[^"]+"/.test(line) || /\[routerLink\]="\[\s*'(?!\/)/.test(line)) {
            offenders.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
