import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { DocumentLifecycle, canTransition, mainPath } from '@virteex/shared/types';
import { LifecycleRegistry } from './lifecycle.registry';

/**
 * Las primitivas del ciclo de vida, sobre ciclos inventados aquí.
 *
 * Deliberadamente NO usa los de compras: `shared/` es plataforma y compras es un módulo, y un
 * espec que cruza esa frontera la borra igual que la borraría el código. Lo que se declara de
 * verdad se prueba en su propio módulo (`procurement/procurement-lifecycles.spec.ts`), que es
 * donde vive quien sabe si una orden puede pasar de enviada a recibida.
 *
 * Lo que se protege aquí no es que `canTransition` sepa buscar en una lista —eso es una línea—,
 * sino la propiedad que hace que declarar el ciclo valga la pena: que la regla que aplica el
 * servidor al rechazar una transición y la que dibuja la pantalla sean LA MISMA. El último bloque
 * comprueba justo eso leyendo el código, porque es la única forma de comprobar que algo NO está
 * escrito en ningún sitio.
 */
describe('ciclo de vida de un documento', () => {
  /** Un ciclo con forma de documento real: un camino, un desvío excepcional y un retroceso. */
  const CICLO: DocumentLifecycle = {
    documentType: 'prueba',
    labelKey: 'prueba.documento',
    stages: [
      { status: 'DRAFT', labelKey: 'p.draft', next: ['PENDING', 'CANCELLED'] },
      { status: 'PENDING', labelKey: 'p.pending', next: ['APPROVED', 'DRAFT', 'CANCELLED'] },
      { status: 'APPROVED', labelKey: 'p.approved', next: ['DONE', 'CANCELLED'] },
      { status: 'DONE', labelKey: 'p.done', next: [] },
      { status: 'CANCELLED', labelKey: 'p.cancelled', next: [], exceptional: true },
    ],
  };

  describe('canTransition', () => {
    it('deja pasar lo declarado y solo lo declarado', () => {
      expect(canTransition(CICLO, 'DRAFT', 'PENDING')).toBe(true);
      // Saltarse la aprobación es exactamente lo que la tabla existe para impedir.
      expect(canTransition(CICLO, 'DRAFT', 'APPROVED')).toBe(false);
    });

    it('es falso desde una etapa final: `next` vacío es el final, no un olvido', () => {
      expect(canTransition(CICLO, 'DONE', 'DRAFT')).toBe(false);
    });

    it('es falso, y no revienta, ante un estado que el ciclo no declara', () => {
      // Llega de la base de datos o de una versión anterior del producto. Que el guardia diga
      // «no» es lo correcto; que lance por leer `undefined.includes` no lo es.
      expect(canTransition(CICLO, 'INVENTADO', 'DRAFT')).toBe(false);
    });
  });

  describe('mainPath', () => {
    it('recorre de la primera etapa a un final', () => {
      expect(mainPath(CICLO)).toEqual(['DRAFT', 'PENDING', 'APPROVED', 'DONE']);
    });

    it('deja fuera las etapas excepcionales aunque sean alcanzables', () => {
      // `CANCELLED` se alcanza desde casi cualquier punto. Una línea que la incluya sugiere que
      // cancelar es un paso del camino, y no lo es.
      expect(mainPath(CICLO)).not.toContain('CANCELLED');
    });

    it('no da vueltas cuando el ciclo permite retroceder', () => {
      // De `PENDING` se puede volver a `DRAFT`. Seguir el camino sin cortar visitaría las dos
      // eternamente, y la pantalla que lo dibuja se colgaría con él.
      const conVuelta: DocumentLifecycle = {
        documentType: 'vuelta',
        labelKey: 'vuelta',
        stages: [
          { status: 'a', labelKey: 'a', next: ['b'] },
          { status: 'b', labelKey: 'b', next: ['a', 'c'] },
          { status: 'c', labelKey: 'c', next: [] },
        ],
      };
      expect(mainPath(conVuelta)).toEqual(['a', 'b']);
    });

    it('es vacío si el ciclo no declara etapas', () => {
      expect(mainPath({ documentType: 'x', labelKey: 'x', stages: [] })).toEqual([]);
    });
  });

  describe('registro', () => {
    let registry: LifecycleRegistry;

    beforeEach(() => {
      registry = new LifecycleRegistry();
    });

    it('devuelve lo que se apuntó', () => {
      registry.register(CICLO);
      expect(registry.get('prueba')).toBe(CICLO);
      expect(registry.all()).toEqual([CICLO]);
    });

    it('devuelve null —y no lanza— para un documento que no declara su vida', () => {
      // La mayoría de los documentos del producto todavía están así. Que el registro lo diga en
      // vez de reventar es lo que permite que la pantalla simplemente no enseñe la tira.
      expect(registry.get('journal-entry')).toBeNull();
    });

    it('conserva el primero ante un duplicado y lo avisa', () => {
      const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const impostor: DocumentLifecycle = {
        documentType: 'prueba',
        labelKey: 'otro',
        stages: [],
      };

      registry.register(CICLO);
      registry.register(impostor);

      // Ganar el último convertiría el orden de arranque de los módulos en una regla de negocio.
      expect(registry.get('prueba')).toBe(CICLO);
      expect(aviso).toHaveBeenCalled();
      aviso.mockRestore();
    });
  });

  /**
   * El motivo de todo lo anterior.
   *
   * Declarar el ciclo de vida solo sirve mientras nadie vuelva a escribir la tabla dentro de un
   * servicio: en el momento en que hay dos, la pantalla y el servidor pueden discrepar y nada lo
   * avisa hasta que un comprador ve un botón que el servidor rechaza.
   *
   * Se probó que falla: añadiendo `const X: Record<PurchaseOrderStatus, PurchaseOrderStatus[]>`
   * a `purchase-orders.service.ts`, esta prueba se pone roja y nombra el fichero.
   */
  describe('sin tablas de transición sueltas', () => {
    const RAIZ = join(__dirname, '..', '..');
    /** `const NOMBRE: Record<AlgoStatus, AlgoStatus[]>` — la forma exacta que se eliminó. */
    const TABLA_SUELTA = /Record<\s*\w*Status\s*,\s*\w*Status\[\]\s*>/;

    function ficherosTypeScript(directorio: string): string[] {
      return readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
        const ruta = join(directorio, entrada.name);
        if (entrada.isDirectory()) return ficherosTypeScript(ruta);
        return entrada.isFile() && ruta.endsWith('.ts') ? [ruta] : [];
      });
    }

    it('la tabla de estados vive en un `*-lifecycles.ts`, no dentro de un servicio', () => {
      const infractores = ficherosTypeScript(RAIZ)
        .filter((ruta) => !ruta.endsWith('-lifecycles.ts') && !ruta.endsWith('.spec.ts'))
        .filter((ruta) => TABLA_SUELTA.test(readFileSync(ruta, 'utf8')))
        .map((ruta) => ruta.slice(RAIZ.length + 1));

      expect(infractores).toEqual([]);
    });
  });
});
