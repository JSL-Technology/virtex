import { mergeWorkspaces, uniqueById } from './workspace-merge';
import { TabModel, TabType } from './tab.model';

const tab = (over: Partial<TabModel> & { route: string }): TabModel =>
  ({
    id: over.route,
    type: TabType.MODULE_LIST,
    title: over.route,
    icon: 'File',
    routeParams: {},
    isDirty: false,
    isLoading: false,
    isCloseable: true,
    isPinned: false,
    createdAt: new Date('2026-01-01'),
    lastActivatedAt: new Date('2026-01-01'),
    ...over,
  }) as TabModel;

/**
 * Esta fusión es lo que separa «continuar en otro equipo» de «perder el trabajo del otro equipo».
 */
describe('mergeWorkspaces', () => {
  it('une las pestañas de los dos equipos', () => {
    const result = mergeWorkspaces(
      [tab({ route: '/invoices' })],
      [tab({ route: '/accounting/journal-entries' })],
    );

    expect(result.map((t) => t.route)).toEqual(['/invoices', '/accounting/journal-entries']);
  });

  it('no duplica la misma página abierta en los dos', () => {
    const result = mergeWorkspaces([tab({ route: '/invoices' })], [tab({ route: '/invoices' })]);

    expect(result).toHaveLength(1);
  });

  it('deduplica por entityKey, igual que al abrir una pestaña', () => {
    const result = mergeWorkspaces(
      [tab({ route: '/invoices/128', entityKey: 'invoice:128' })],
      [tab({ route: '/invoices/128', entityKey: 'invoice:128', id: 'otro' })],
    );

    expect(result).toHaveLength(1);
  });

  it('ante duplicado gana la que se tocó después', () => {
    const result = mergeWorkspaces(
      [tab({ route: '/invoices', scrollPosition: 10 })],
      [tab({ route: '/invoices', scrollPosition: 900, lastActivatedAt: new Date('2026-06-01') })],
    );

    expect(result[0].scrollPosition).toBe(900);
  });

  it('una pestaña SUCIA local no se reemplaza por una remota más reciente', () => {
    // Cambios sin guardar son lo único que no está en ninguna otra parte.
    const result = mergeWorkspaces(
      [tab({ route: '/invoices/new', isDirty: true })],
      [tab({ route: '/invoices/new', lastActivatedAt: new Date('2026-06-01') })],
    );

    expect(result[0].isDirty).toBe(true);
  });

  it('una pestaña sucia REMOTA gana a una local limpia más reciente', () => {
    const result = mergeWorkspaces(
      [tab({ route: '/invoices/new', lastActivatedAt: new Date('2026-06-01') })],
      [tab({ route: '/invoices/new', isDirty: true })],
    );

    expect(result[0].isDirty).toBe(true);
  });

  it('conserva el orden local y añade lo nuevo al final', () => {
    const result = mergeWorkspaces(
      [tab({ route: '/c' }), tab({ route: '/a' }), tab({ route: '/b' })],
      [tab({ route: '/z' }), tab({ route: '/a' })],
    );

    expect(result.map((t) => t.route)).toEqual(['/c', '/a', '/b', '/z']);
  });

  it('con un lado vacío devuelve el otro', () => {
    expect(mergeWorkspaces([], [tab({ route: '/a' })]).map((t) => t.route)).toEqual(['/a']);
    expect(mergeWorkspaces([tab({ route: '/a' })], []).map((t) => t.route)).toEqual(['/a']);
    expect(mergeWorkspaces([], [])).toEqual([]);
  });

  it('no resucita una pestaña cerrada aquí después de su último uso en el otro equipo', () => {
    const closed = new Map([['/invoices', new Date('2026-02-01').getTime()]]);
    const result = mergeWorkspaces([], [tab({ route: '/invoices', lastActivatedAt: new Date('2026-01-15') })], closed);
    expect(result).toEqual([]);
  });

  it('sí trae la pestaña si el otro equipo la usó después de cerrarla aquí', () => {
    const closed = new Map([['/invoices', new Date('2026-01-10').getTime()]]);
    const result = mergeWorkspaces([], [tab({ route: '/invoices', lastActivatedAt: new Date('2026-01-15') })], closed);
    expect(result.map((t) => t.route)).toEqual(['/invoices']);
  });

  it('keeps one window per id when a reused tab changed records on this device', () => {
    const old = new Date('2026-10-01T10:00:00Z');
    const recent = new Date('2026-10-01T11:00:00Z');
    const base = { type: 'RECORD', title: 'x', icon: 'x', isDirty: false, isLoading: false, isCloseable: true, isPinned: false, isPreview: true, createdAt: old, order: 0 } as const;
    // Same window id: on the other device it still shows the map, here it now shows the invoice.
    const local = [{ ...base, id: 'w1', route: '/invoices/88', entityKey: 'invoice:88', lastActivatedAt: recent }];
    const remote = [{ ...base, id: 'w1', route: '/map/1', entityKey: 'map:1', lastActivatedAt: old }];
    const merged = mergeWorkspaces(local as never, remote as never);
    expect(merged.map((t) => t.route)).toEqual(['/invoices/88']);
  });

  it('una vista previa reutilizada no vuelve del servidor como otra pestaña con el mismo id', () => {
    // La ventana «preview» mostraba el diseñador; luego pasó a una ejecución conservando su id.
    const local = [tab({ id: 'preview', route: '/workflow-instances/run-1', entityKey: 'run:1', isPreview: true, lastActivatedAt: new Date('2026-01-03') })];
    const remote = [tab({ id: 'preview', route: '/workflows/d-1/edit', entityKey: 'design:1', isPreview: true, lastActivatedAt: new Date('2026-01-02') })];

    const result = mergeWorkspaces(local, remote);

    expect(result).toHaveLength(1);
    expect(result[0].route).toBe('/workflow-instances/run-1');
  });
});

describe('uniqueById', () => {
  it('cura un espacio guardado con la misma ventana repetida: queda la usada por última vez', () => {
    const tabs = [
      tab({ id: 'home', route: '/overview' }),
      tab({ id: 'preview', route: '/workflows/d-1/edit', lastActivatedAt: new Date('2026-01-02') }),
      tab({ id: 'preview', route: '/workflow-instances/run-1', lastActivatedAt: new Date('2026-01-05') }),
      tab({ id: 'list', route: '/workflow-instances' }),
    ];

    expect(uniqueById(tabs).map((t) => `${t.id}:${t.route}`)).toEqual([
      'home:/overview',
      'preview:/workflow-instances/run-1',
      'list:/workflow-instances',
    ]);
  });
});
