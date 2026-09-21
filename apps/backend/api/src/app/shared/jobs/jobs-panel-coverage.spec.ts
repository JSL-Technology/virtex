import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { NOT_SHOWN, QUEUE_NAMES } from './queue-catalogue';

/**
 * Una cola nueva aparece en el panel, o rompe la construcción.
 *
 * ## Por qué hace falta
 *
 * El panel muestra una lista de colas escrita a mano —`QUEUE_NAMES`— porque BullMQ entrega cada
 * cola por un token construido con su nombre en tiempo de compilación, y un registro al que cada
 * módulo se apunte costaría un proveedor por cola solo para eso.
 *
 * Una lista escrita a mano se desvía. Este producto ya pagó esa deuda una vez: el catálogo de
 * ventanas del cliente se mantenía aparte de la tabla de rutas, las dos se separaron, y cuarenta
 * enlaces del menú abrían una tarjeta de «en construcción» sobre páginas que existían. La lección
 * no fue «tener más cuidado»: fue derivar la lista, y donde no se puede derivar, ponerle una
 * guardia.
 *
 * Esta es la guardia. Lee los `@Processor(...)` del código y exige que cada cola esté en el
 * catálogo, mostrada o exenta con su motivo escrito.
 */
const APP_DIR = join(__dirname, '..', '..');

function archivosTypeScript(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) archivosTypeScript(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

/**
 * El nombre de la cola de un procesador.
 *
 * Admite el literal —`@Processor('account-jobs')`— y la constante —`@Processor(MAIL_QUEUE)`—,
 * resolviendo la segunda contra su declaración. Sin eso, dos de las cuatro colas del producto
 * serían invisibles para esta comprobación, que es exactamente el tipo de agujero silencioso que
 * viene a cerrar.
 */
function colasDeclaradas(): Array<{ queue: string; file: string }> {
  const encontradas: Array<{ queue: string; file: string }> = [];
  const constantes = new Map<string, string>();

  const ficheros = archivosTypeScript(APP_DIR);

  for (const file of ficheros) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/export const (\w+)\s*=\s*'([^']+)'/g)) {
      if (m[1].endsWith('_QUEUE')) constantes.set(m[1], m[2]);
    }
  }

  for (const file of ficheros) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/@Processor\(\s*(?:'([^']+)'|(\w+))/g)) {
      const literal = m[1];
      const porConstante = m[2] ? constantes.get(m[2]) : undefined;
      const queue = literal ?? porConstante;
      if (queue) encontradas.push({ queue, file: file.slice(APP_DIR.length + 1) });
      else if (m[2]) {
        throw new Error(
          `${file.slice(APP_DIR.length + 1)} declara @Processor(${m[2]}) y no se pudo resolver ` +
            'esa constante. Expórtala como `export const X_QUEUE = \'...\'` para que esta ' +
            'comprobación pueda verla.',
        );
      }
    }
  }
  return encontradas;
}

describe('cobertura del panel de trabajos', () => {
  it('toda cola con procesador está en el catálogo', () => {
    const fuera = colasDeclaradas()
      .filter(({ queue }) => !(QUEUE_NAMES as readonly string[]).includes(queue))
      .map(({ queue, file }) => `${queue} (${file})`);

    expect(fuera).toEqual([]);
  });

  it('toda cola del catálogo se muestra, o dice por qué no', () => {
    const sinExplicar = QUEUE_NAMES.filter((name) => {
      const exenta = name in NOT_SHOWN;
      return exenta && !NOT_SHOWN[name]?.trim();
    });

    // «No se muestra» tiene que ser una frase que alguien escribió, no una ausencia.
    expect(sinExplicar).toEqual([]);
  });

  it('el catálogo no nombra colas que ya no existen', () => {
    const reales = new Set(colasDeclaradas().map(({ queue }) => queue));
    const fantasmas = QUEUE_NAMES.filter((name) => !reales.has(name));

    // Una cola en el catálogo sin procesador es un panel que promete un trabajo que nadie ejecuta.
    expect(fantasmas).toEqual([]);
  });
});
