import { mergeWorkspaces } from './workspace-merge';
import { TabModel, TabType } from './tab.model';

const tab = (over: Partial<TabModel> & { route: string }): TabModel =>
  ({
    id: over.route,
    type: TabType.LIST,
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
});
