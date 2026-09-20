import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { DocumentLifecycle, canTransition, mainPath } from '@virteex/shared/types';
import { LifecycleRegistry } from './lifecycle.registry';
import {
  PURCHASE_ORDER_LIFECYCLE,
  REQUISITION_LIFECYCLE,
} from '../../procurement/procurement-lifecycles';
import { PurchaseOrderStatus } from '../../procurement/entities/purchase-order.entity';
import { PurchaseRequisitionStatus } from '../../procurement/entities/purchase-requisition.entity';

/**
 * El ciclo de vida declarado.
 *
 * Lo que estas pruebas protegen no es que `canTransition` sepa buscar en una lista —eso es una
 * línea—, sino la propiedad que hace que declararlo valga la pena: que la regla que aplica el
 * servidor al rechazar una transición y la que dibuja la pantalla sean LA MISMA. Si alguien vuelve
 * a poner una tabla de transiciones dentro de un servicio, estas pruebas siguen pasando y el
 * producto vuelve a tener dos verdades; por eso la última comprueba explícitamente que las
 * constantes viejas no han vuelto.
 */
describe('ciclo de vida de un documento', () => {
  describe('canTransition', () => {
    it('deja pasar lo declarado y solo lo declarado', () => {
      expect(
        canTransition(
          REQUISITION_LIFECYCLE,
          PurchaseRequisitionStatus.DRAFT,
          PurchaseRequisitionStatus.PENDING_APPROVAL,
        ),
      ).toBe(true);

      // Saltarse la aprobación es exactamente lo que la tabla existe para impedir.
      expect(
        canTransition(
          REQUISITION_LIFECYCLE,
          PurchaseRequisitionStatus.DRAFT,
          PurchaseRequisitionStatus.APPROVED,
        ),
      ).toBe(false);
    });

    it('es falso desde una etapa final: `next` vacío es el final, no un olvido', () => {
      expect(
        canTransition(
          PURCHASE_ORDER_LIFECYCLE,
          PurchaseOrderStatus.RECEIVED,
          PurchaseOrderStatus.DRAFT,
        ),
      ).toBe(false);
    });

    it('es falso, y no revienta, ante un estado que el ciclo no declara', () => {
      // Llega de la base de datos o de una versión anterior del producto. Que el guardia diga
      // «no» es lo correcto; que lance por leer `undefined.includes` no lo es.
      expect(
        canTransition(
          PURCHASE_ORDER_LIFECYCLE,
          'inventado' as PurchaseOrderStatus,
          PurchaseOrderStatus.DRAFT,
        ),
      ).toBe(false);
    });
  });

  describe('mainPath', () => {
    it('recorre de la primera etapa a un final', () => {
      expect(mainPath(PURCHASE_ORDER_LIFECYCLE)).toEqual([
        PurchaseOrderStatus.DRAFT,
        PurchaseOrderStatus.PENDING_APPROVAL,
        PurchaseOrderStatus.APPROVED,
        PurchaseOrderStatus.SENT,
        PurchaseOrderStatus.PARTIALLY_RECEIVED,
        PurchaseOrderStatus.RECEIVED,
      ]);
    });

    it('deja fuera las etapas excepcionales aunque sean alcanzables', () => {
      // `CANCELLED` se alcanza desde casi cualquier punto y `REJECTED` desde la aprobación. Una
      // línea que las incluya sugiere que cancelar es un paso del camino, y no lo es.
      expect(mainPath(PURCHASE_ORDER_LIFECYCLE)).not.toContain(PurchaseOrderStatus.CANCELLED);
      expect(mainPath(REQUISITION_LIFECYCLE)).not.toContain(PurchaseRequisitionStatus.REJECTED);
    });

    it('no da vueltas cuando el ciclo permite retroceder', () => {
      // De `PENDING_APPROVAL` se puede volver a `DRAFT`. Seguir el camino sin cortar visitaría
      // las dos eternamente, y la pantalla que lo dibuja se colgaría con él.
      const conVuelta: DocumentLifecycle = {
        documentType: 'prueba',
        labelKey: 'prueba',
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

  describe('coherencia de lo declarado', () => {
    const declarados = [REQUISITION_LIFECYCLE, PURCHASE_ORDER_LIFECYCLE];

    it.each(declarados.map((l) => [l.documentType, l] as const))(
      '%s: toda etapa alcanzable está declarada',
      (_tipo, lifecycle) => {
        const declaradas = new Set(lifecycle.stages.map((s) => s.status));
        for (const stage of lifecycle.stages) {
          for (const siguiente of stage.next) {
            // Un `next` que apunta a una etapa inexistente es un callejón: el servidor rechaza la
            // transición y nadie entiende por qué, porque la etapa se lee bien en el código.
            expect(declaradas).toContain(siguiente);
          }
        }
      },
    );

    it.each(declarados.map((l) => [l.documentType, l] as const))(
      '%s: cubre todos los estados del enum, sin inventarse ninguno',
      (_tipo, lifecycle) => {
        const enumerado =
          lifecycle === REQUISITION_LIFECYCLE
            ? Object.values(PurchaseRequisitionStatus)
            : Object.values(PurchaseOrderStatus);
        // Un estado del enum que el ciclo no declara es un documento que existe en la base de
        // datos y que la pantalla no sabe dibujar.
        expect(lifecycle.stages.map((s) => s.status).sort()).toEqual([...enumerado].sort());
      },
    );

    it.each(declarados.map((l) => [l.documentType, l] as const))(
      '%s: la primera etapa es donde nace el documento',
      (_tipo, lifecycle) => {
        // `mainPath` arranca por `stages[0]`. Si el orden del array deja de significar eso, la
        // tira de etapas empieza por el sitio equivocado sin que nada más se queje.
        expect(lifecycle.stages[0].status).toBe('DRAFT');
      },
    );
  });

  describe('registro', () => {
    let registry: LifecycleRegistry;

    beforeEach(() => {
      registry = new LifecycleRegistry();
    });

    it('devuelve lo que se apuntó', () => {
      registry.register(PURCHASE_ORDER_LIFECYCLE);
      expect(registry.get('purchase-order')).toBe(PURCHASE_ORDER_LIFECYCLE);
      expect(registry.all()).toEqual([PURCHASE_ORDER_LIFECYCLE]);
    });

    it('devuelve null —y no lanza— para un documento que no declara su vida', () => {
      // La mayoría de los documentos del producto todavía están así. Que el registro lo diga en
      // vez de reventar es lo que permite que la pantalla simplemente no enseñe la tira.
      expect(registry.get('journal-entry')).toBeNull();
    });

    it('conserva el primero ante un duplicado y lo avisa', () => {
      const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const impostor: DocumentLifecycle = {
        documentType: 'purchase-order',
        labelKey: 'otro',
        stages: [],
      };

      registry.register(PURCHASE_ORDER_LIFECYCLE);
      registry.register(impostor);

      // Ganar el último convertiría el orden de arranque de los módulos en una regla de negocio.
      expect(registry.get('purchase-order')).toBe(PURCHASE_ORDER_LIFECYCLE);
      expect(aviso).toHaveBeenCalled();
      aviso.mockRestore();
    });
  });
  /**
   * El motivo de todo lo anterior.
   *
   * Declarar el ciclo de vida solo sirve mientras nadie vuelva a escribir la tabla dentro de un
   * servicio: en el momento en que hay dos, la pantalla y el servidor pueden discrepar y nada lo
   * avisa hasta que un comprador ve un botón que el servidor rechaza. Esto lo comprueba leyendo
   * el código, que es la única forma de comprobar que algo NO está escrito en ningún sitio.
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
  /**
   * Una etapa cuya clave no está en el catálogo se dibuja con la clave cruda —
   * `purchasing.orders.status_label.sent` dentro de la insignia— y eso es lo que ve el comprador.
   * El verificador de catálogos no puede cazarlo porque estas claves no aparecen como literal en
   * ninguna plantilla: se componen aquí, en el servidor.
   */
  describe('las etiquetas declaradas existen en el catálogo', () => {
    function raizDelRepositorio(): string {
      let directorio = __dirname;
      while (!existsSync(join(directorio, 'libs', 'shared', 'locales'))) {
        const padre = join(directorio, '..');
        if (padre === directorio) throw new Error('No se encontró la raíz del repositorio');
        directorio = padre;
      }
      return directorio;
    }

    const BASE = join(raizDelRepositorio(), 'libs', 'shared', 'locales', 'src', 'base');
    const IDIOMAS = ['es', 'en', 'pt'] as const;

    /** Todas las claves del catálogo con los idiomas que realmente traen texto. */
    const catalogo = new Map<string, string[]>(
      readdirSync(BASE)
        .filter((nombre) => nombre.endsWith('.json'))
        .flatMap((nombre) =>
          Object.entries(
            JSON.parse(readFileSync(join(BASE, nombre), 'utf8')) as Record<string, unknown>,
          )
            .filter(([clave]) => !clave.startsWith('$'))
            .map(
              ([clave, valor]) =>
                [
                  clave,
                  IDIOMAS.filter((idioma) => (valor as Record<string, string>)?.[idioma]),
                ] as [string, string[]],
            ),
        ),
    );

    const declaradas = [REQUISITION_LIFECYCLE, PURCHASE_ORDER_LIFECYCLE].flatMap((lifecycle) => [
      [lifecycle.documentType, lifecycle.labelKey] as const,
      ...lifecycle.stages.map((stage) => [lifecycle.documentType, stage.labelKey] as const),
    ]);

    it.each(declaradas)('%s: «%s» está traducida a los tres idiomas', (_tipo, clave) => {
      expect(catalogo.get(clave) ?? []).toEqual([...IDIOMAS]);
    });
  });
});
