import { MenuItem } from './context-menu.types';
import { rowActionSections, screenActionSections } from './row-actions';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';

/** Every table row's menu, from what the row already offers (QA R3-B08). */
describe('row actions', () => {
  const navigation = { open: jest.fn(), copyLink: jest.fn() } as unknown as NavigationActionsService;

  function table(html: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
  }

  const flat = (items: MenuItem[]): MenuItem[] => items.flatMap((item) => [item, ...(item.submenu ?? [])]);

  it('offers the destination, then the row own controls by their names, then its link', () => {
    const host = table(`<table><tbody><tr>
      <td><a class="table-link" href="/e/acme/hcm/departments/1">Ventas</a></td>
      <td><button type="button" aria-label="Editar Ventas">✎</button>
          <button type="button" class="danger-button">Eliminar</button>
          <button type="button" disabled>Aprobar</button>
          <button type="button" hidden>Oculto</button></td>
    </tr></tbody></table>`);
    const row = host.querySelector('tr') as HTMLElement;
    const deleted = jest.fn();
    host.querySelector('.danger-button')!.addEventListener('click', deleted);

    const sections = rowActionSections(row, navigation);
    expect(sections.map((section) => section.id)).toEqual(['open', 'row-actions', 'share']);
    const actions = sections[1].items;
    expect(actions.map((item) => item.text)).toEqual(['Editar Ventas', 'Eliminar', 'Aprobar']);
    expect(actions[1].danger).toBe(true);
    expect(actions[2].disabled?.({} as never)).toBe(true);

    actions[1].run?.({} as never);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(flat(sections[0].items).map((item) => item.id)).toContain('open-side');
    host.remove();
  });

  it('still has a menu for a row with actions and no link, and none for a row with neither', () => {
    const host = table(`<table><tbody>
      <tr id="a"><td>Línea 1</td><td><button type="button">Quitar línea</button></td></tr>
      <tr id="b"><td>Solo texto</td></tr>
    </tbody></table>`);
    expect(rowActionSections(host.querySelector('#a') as HTMLElement, navigation).map((s) => s.id)).toEqual(['row-actions']);
    expect(rowActionSections(host.querySelector('#b') as HTMLElement, navigation)).toEqual([]);
    host.remove();
  });

  it('offers the screen commands on the table itself', () => {
    const host = table(`<vx-list-shell><div class="ls__actions"><button type="button">Nuevo almacén</button><button type="button">Exportar</button></div>
      <table><tbody></tbody></table></vx-list-shell>`);
    const sections = screenActionSections(host.querySelector('table') as HTMLElement);
    expect(sections[0].items.map((item) => item.text)).toEqual(['Nuevo almacén', 'Exportar']);
    host.remove();
  });
});
