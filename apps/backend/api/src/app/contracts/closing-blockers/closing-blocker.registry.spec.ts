import { ClosingBlockerRegistry } from './closing-blocker.registry';
import {
  ClosingBlocker,
  ClosingBlockerProvider,
  ClosingPeriodQuery,
} from './closing-blocker.contract';

const PERIOD: ClosingPeriodQuery = {
  organizationId: 'org-1',
  periodId: 'period-1',
  startDate: '2026-09-01',
  endDate: '2026-09-30',
};

const provider = (
  name: string,
  answer: () => Promise<readonly ClosingBlocker[]>,
): ClosingBlockerProvider => ({ providerName: name, blockersFor: answer });

const line = (id: string): ClosingBlocker => ({
  id,
  descriptionKey: `k.${id}`,
  isCompleted: false,
});

describe('ClosingBlockerRegistry', () => {
  let registry: ClosingBlockerRegistry;

  beforeEach(() => {
    registry = new ClosingBlockerRegistry();
    // El registro escribe un `logger.error` por proveedor caído. Es la señal correcta en
    // producción y ruido en la salida de las pruebas.
    jest.spyOn(registry['logger'], 'error').mockImplementation(() => undefined);
  });

  it('devuelve las líneas de cada proveedor en el orden en que se registraron', async () => {
    registry.register(provider('compras', async () => [line('a')]));
    registry.register(provider('finanzas', async () => [line('b'), line('c')]));

    expect((await registry.collect(PERIOD)).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('no duplica un proveedor que se registra dos veces', async () => {
    const p = provider('compras', async () => [line('a')]);
    registry.register(p);
    registry.register(p);

    expect(registry.registeredNames).toEqual(['compras']);
    expect(await registry.collect(PERIOD)).toHaveLength(1);
  });

  /**
   * El checklist es un diagnóstico para quien está cerrando el mes. Un módulo caído tiene que
   * degradar su propia línea; si tumbara la pantalla, el cierre se detendría por una consulta que
   * solo era informativa.
   */
  it('convierte el fallo de un proveedor en una línea sin completar, sin afectar a los demás', async () => {
    registry.register(
      provider('compras', async () => {
        throw new Error('la base de datos de compras no responde');
      }),
    );
    registry.register(provider('finanzas', async () => [line('b')]));

    const result = await registry.collect(PERIOD);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'compras-unavailable',
      isCompleted: false,
      params: { provider: 'compras' },
    });
    expect(result[1].id).toBe('b');
  });

  /**
   * La razón de existir del registro: Contabilidad pregunta sin conocer a nadie. Sin proveedores
   * registrados —porque el módulo se extrajo a su propio servicio, por ejemplo— el checklist pierde
   * esas líneas y no se rompe ningún import.
   */
  it('devuelve una lista vacía cuando nadie se ha registrado', async () => {
    expect(await registry.collect(PERIOD)).toEqual([]);
  });

  it('pregunta a los proveedores en paralelo, no en serie', async () => {
    const started: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    registry.register(
      provider('lento', async () => {
        started.push('lento');
        await firstHeld;
        return [line('a')];
      }),
    );
    registry.register(
      provider('rapido', async () => {
        started.push('rapido');
        return [line('b')];
      }),
    );

    const pending = registry.collect(PERIOD);
    await Promise.resolve();
    // El segundo arrancó sin esperar a que el primero terminara.
    expect(started).toEqual(['lento', 'rapido']);

    releaseFirst();
    expect((await pending).map((l) => l.id)).toEqual(['a', 'b']);
  });
});
