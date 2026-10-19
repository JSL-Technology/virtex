import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ListSelectionService } from './list-selection.service';
import { ContextMenuService } from './context-menu.service';
import { ContextMenuComponent } from './context-menu.component';
import { TableMenuDirective } from './table-menu.directive';
import { RowMenuDirective } from './row-menu.directive';
import { ListMenuConfig, MenuContext } from './context-menu.types';
import { AuthService } from '../../../core/services/auth';

interface Row {
  id: string;
  name: string;
}

describe('ListSelectionService', () => {
  const rows: Row[] = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
  let svc: ListSelectionService<Row>;

  beforeEach(() => {
    svc = new ListSelectionService<Row>();
    svc.setItems(rows, (r) => r.id);
  });

  it('toggles one id', () => {
    svc.toggle('b');
    expect(svc.isSelected('b')).toBe(true);
    expect(svc.count()).toBe(1);
  });

  it('selects a range from the last anchor', () => {
    svc.toggle('a');
    svc.selectRange('c');
    expect(svc.selected().map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('select-all toggles every row and back', () => {
    svc.toggleAll();
    expect(svc.count()).toBe(4);
    svc.toggleAll();
    expect(svc.count()).toBe(0);
  });

  it('drops selection that no longer exists after re-listing', () => {
    svc.toggle('d');
    svc.setItems([{ id: 'a', name: 'A' }], (r) => r.id);
    expect(svc.count()).toBe(0);
  });
});

describe('ContextMenuService', () => {
  const section = { id: 's', items: [{ id: 'i', label: 'x' }] };
  const ctx: MenuContext = { kind: 'row', selection: [], event: new MouseEvent('contextmenu') };

  it('does nothing when no host is registered', () => {
    const svc = new ContextMenuService();
    expect(() => svc.open(new MouseEvent('contextmenu'), [section], ctx)).not.toThrow();
  });

  it('does nothing when there are no sections', () => {
    const svc = new ContextMenuService();
    const calls: unknown[] = [];
    svc.registerHost({ openAt: () => calls.push(true), close: () => undefined });
    svc.open(new MouseEvent('contextmenu'), [], ctx);
    expect(calls).toHaveLength(0);
  });

  it('opens at the pointer coordinates and stores the request', () => {
    const svc = new ContextMenuService();
    const calls: Array<{ x: number; y: number }> = [];
    svc.registerHost({ openAt: (x, y) => calls.push({ x, y }), close: () => undefined });
    svc.open(new MouseEvent('contextmenu', { clientX: 42, clientY: 7 }), [section], ctx);
    expect(calls).toEqual([{ x: 42, y: 7 }]);
    expect(svc.sections()).toHaveLength(1);
    expect(svc.context()?.kind).toBe('row');
  });
});

@Component({
  standalone: true,
  imports: [TableMenuDirective, RowMenuDirective],
  template: `
    <table [appTableMenu]="menu">
      <tbody>
        <tr [appRowMenu]="row"><td>x</td></tr>
      </tbody>
    </table>
  `,
})
class Host {
  row: Row = { id: 'p1', name: 'Prod' };
  menu: ListMenuConfig<Row> = {
    resource: 'rows',
    table: [{ id: 't', items: [{ id: 'new', label: 'new' }] }],
    row: () => [{ id: 'r', items: [{ id: 'edit', label: 'edit', run: () => undefined }] }],
  };
}

describe('appRowMenu / appTableMenu', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [Host] });
    const service = TestBed.inject(ContextMenuService);
    const seen: Array<MenuContext | null> = [];
    service.registerHost({ openAt: () => seen.push(service.context()), close: () => undefined });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, service, seen };
  }

  it('opens a row menu with the row entity and both row+table sections', () => {
    const { fixture, service } = setup();
    const tr = fixture.nativeElement.querySelector('tr') as HTMLElement;
    tr.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));

    expect(service.context()?.kind).toBe('row');
    expect((service.context()?.entity as Row).id).toBe('p1');
    // row section + inherited table section
    expect(service.sections().map((s) => s.id)).toEqual(['r', 't']);
  });

  it('opens a table menu (not a row menu) when the click is outside any row', () => {
    const { fixture, service } = setup();
    const table = fixture.nativeElement.querySelector('table') as HTMLElement;
    table.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));

    expect(service.context()?.kind).toBe('table');
    expect(service.sections().map((s) => s.id)).toEqual(['t']);
  });
});

@Component({ standalone: true, imports: [ContextMenuComponent], template: `<vx-context-menu />` })
class HostApp {}

describe('ContextMenuComponent (overlay rendering)', () => {
  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  // Catches the cdk-menu-stack regression: rendering items through ngTemplateOutlet broke the
  // injector chain so every cdkMenuItem threw NG0201 and the overlay never painted. Rendering the
  // real panel through the overlay is the only thing that exercises that wiring.
  it('paints the menu items in the overlay and runs the clicked one', () => {
    TestBed.configureTestingModule({
      imports: [HostApp],
      providers: [{ provide: AuthService, useValue: { hasPermissions: () => true } }],
    });
    const fixture = TestBed.createComponent(HostApp);
    fixture.detectChanges();

    const service = TestBed.inject(ContextMenuService);
    const ran: string[] = [];
    const event = new MouseEvent('contextmenu', { clientX: 10, clientY: 10 });
    const ctx: MenuContext = { kind: 'row', selection: [], event };
    service.open(event, [{ id: 's', items: [
      { id: 'a', label: 'Alpha', run: () => { ran.push('a'); } },
      { id: 'b', label: 'Beta', run: () => { ran.push('b'); } },
    ] }], ctx);
    fixture.detectChanges();

    const items = Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container .vx-ctx-trigger'));
    expect(items).toHaveLength(2);

    items[0].click();
    expect(ran).toEqual(['a']);
  });

  it('hides an item the user lacks permission for', () => {
    TestBed.configureTestingModule({
      imports: [HostApp],
      providers: [{ provide: AuthService, useValue: { hasPermissions: (perms: string[]) => !perms.includes('secret') } }],
    });
    const fixture = TestBed.createComponent(HostApp);
    fixture.detectChanges();

    const service = TestBed.inject(ContextMenuService);
    const event = new MouseEvent('contextmenu', { clientX: 10, clientY: 10 });
    service.open(event, [{ id: 's', items: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta', permission: 'secret' },
    ] }], { kind: 'row', selection: [], event });
    fixture.detectChanges();

    const items = Array.from(document.querySelectorAll<HTMLElement>('.cdk-overlay-container .vx-ctx-trigger'));
    expect(items).toHaveLength(1);
  });
});
