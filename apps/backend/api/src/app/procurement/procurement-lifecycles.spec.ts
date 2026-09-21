import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { canTransition, mainPath } from '@virteex/shared/types';

import { PURCHASE_ORDER_LIFECYCLE, REQUISITION_LIFECYCLE } from './procurement-lifecycles';
import { PurchaseOrderStatus } from './entities/purchase-order.entity';
import { PurchaseRequisitionStatus } from './entities/purchase-requisition.entity';

/**
 * Lo que compras declara sobre la vida de sus dos documentos.
 *
 * Las primitivas —`canTransition`, `mainPath`, el registro— se prueban en plataforma sobre ciclos
 * inventados. Esto es lo otro: que lo DECLARADO aquí sea coherente, porque una declaración
 * incoherente no rompe ninguna función, rompe una pantalla. Un `next` que apunta a una etapa
 * inexistente deja un callejón que el servidor rechaza sin que nadie entienda por qué; un estado
 * del enum que el ciclo no menciona es un documento que existe en la base de datos y que la tira
 * de etapas no sabe dibujar.
 */
describe('ciclos de vida de compras', () => {
  const declarados = [
    ['purchase-requisition', REQUISITION_LIFECYCLE] as const,
    ['purchase-order', PURCHASE_ORDER_LIFECYCLE] as const,
  ];

  it('la requisición no puede saltarse la aprobación', () => {
    expect(
      canTransition(
        REQUISITION_LIFECYCLE,
        PurchaseRequisitionStatus.DRAFT,
        PurchaseRequisitionStatus.PENDING_APPROVAL,
      ),
    ).toBe(true);
    expect(
      canTransition(
        REQUISITION_LIFECYCLE,
        PurchaseRequisitionStatus.DRAFT,
        PurchaseRequisitionStatus.APPROVED,
      ),
    ).toBe(false);
  });

  it('una orden recibida ya no vuelve a borrador', () => {
    // Sus términos dejaron de depender solo de nosotros en el momento en que se envió.
    expect(
      canTransition(
        PURCHASE_ORDER_LIFECYCLE,
        PurchaseOrderStatus.RECEIVED,
        PurchaseOrderStatus.DRAFT,
      ),
    ).toBe(false);
  });

  it('el camino de una orden es el que espera un comprador', () => {
    expect(mainPath(PURCHASE_ORDER_LIFECYCLE)).toEqual([
      PurchaseOrderStatus.DRAFT,
      PurchaseOrderStatus.PENDING_APPROVAL,
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.SENT,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
      PurchaseOrderStatus.RECEIVED,
    ]);
  });

  it('cancelar y rechazar quedan fuera de la línea', () => {
    expect(mainPath(PURCHASE_ORDER_LIFECYCLE)).not.toContain(PurchaseOrderStatus.CANCELLED);
    expect(mainPath(REQUISITION_LIFECYCLE)).not.toContain(PurchaseRequisitionStatus.REJECTED);
  });

  it.each(declarados)('%s: toda etapa alcanzable está declarada', (_tipo, lifecycle) => {
    const declaradas = new Set<string>(lifecycle.stages.map((s) => s.status as string));
    for (const stage of lifecycle.stages) {
      for (const siguiente of stage.next) {
        expect(declaradas).toContain(siguiente as string);
      }
    }
  });

  it.each(declarados)('%s: cubre todos los estados del enum, sin inventarse ninguno', (tipo, lifecycle) => {
    const enumerado: string[] =
      tipo === 'purchase-requisition'
        ? Object.values(PurchaseRequisitionStatus)
        : Object.values(PurchaseOrderStatus);
    expect((lifecycle.stages.map((s) => s.status) as string[]).sort()).toEqual(
      [...enumerado].sort(),
    );
  });

  it.each(declarados)('%s: la primera etapa es donde nace el documento', (_tipo, lifecycle) => {
    // `mainPath` arranca por `stages[0]`. Si el orden del array deja de significar eso, la tira de
    // etapas empieza por el sitio equivocado sin que nada más se queje.
    expect(lifecycle.stages[0].status).toBe('DRAFT');
  });

  /**
   * Una etapa cuya clave no está en el catálogo se dibuja con la clave cruda —
   * `purchasing.orders.status_label.sent` dentro de la insignia— y eso es lo que ve el comprador.
   * El verificador de catálogos no puede cazarlo porque estas claves no aparecen como literal en
   * ninguna plantilla: se componen en el servidor.
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

    const claves = declarados.flatMap(([tipo, lifecycle]) => [
      [tipo, lifecycle.labelKey] as const,
      ...lifecycle.stages.map((stage) => [tipo, stage.labelKey] as const),
    ]);

    it.each(claves)('%s: «%s» está traducida a los tres idiomas', (_tipo, clave) => {
      expect(catalogo.get(clave) ?? []).toEqual([...IDIOMAS]);
    });
  });
});
