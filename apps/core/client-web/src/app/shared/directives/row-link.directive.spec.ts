import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RowLinkDirective } from './row-link.directive';
import { ContextMenuService } from '../components/context-menu/context-menu.service';
import { NavigationActionsService } from '../../core/navigation/navigation-actions.service';
import { MenuSection } from '../components/context-menu/context-menu.types';

@Component({
  standalone: true,
  imports: [RowLinkDirective],
  template: `<table><tbody><tr appRowLink>
    <td><a class="table-link" href="/e/acme/invoices/inv-1" (click)="opened = opened + 1; $event.preventDefault()">2026-08</a></td>
    <td class="amount">1,000.00</td>
    <td><button type="button" (click)="pressed = pressed + 1">Aprobar</button></td>
  </tr></tbody></table>`,
})
class Host {
  opened = 0;
  pressed = 0;
}

describe('RowLinkDirective (QA B-02)', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('opens the row from any cell, through the row’s own link', () => {
    const { fixture, el } = render();
    (el.querySelector('.amount') as HTMLElement).click();
    expect(fixture.componentInstance.opened).toBe(1);
  });

  it('leaves the row’s own controls alone', () => {
    const { fixture, el } = render();
    el.querySelector('button')!.click();
    expect(fixture.componentInstance.pressed).toBe(1);
    expect(fixture.componentInstance.opened).toBe(0);
  });

  it('does not open twice when the link itself is clicked', () => {
    const { fixture, el } = render();
    (el.querySelector('a') as HTMLElement).click();
    expect(fixture.componentInstance.opened).toBe(1);
  });

  describe('its menu (QA R3-B08)', () => {
    let opened: { sections: MenuSection[] } | null;
    const navigation = { open: jest.fn(), copyLink: jest.fn() };

    beforeEach(() => {
      opened = null;
      jest.clearAllMocks();
      TestBed.configureTestingModule({
        providers: [
          { provide: ContextMenuService, useValue: { open: (_e: Event, sections: MenuSection[]) => (opened = { sections }) } },
          { provide: NavigationActionsService, useValue: navigation },
        ],
      });
    });

    it('offers what the side menu offers for a page, on a right-click anywhere in the row', () => {
      const { el } = render();
      (el.querySelector('.amount') as HTMLElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      expect(opened?.sections.flatMap((section) => section.items.map((item) => item.id))).toEqual([
        'open', 'open-tab', 'open-background', 'open-side', 'open-window', 'copy-link',
      ]);
      const item = (id: string) => opened!.sections.flatMap((section) => section.items).find((entry) => entry.id === id)!;
      item('open-side').run!({} as never);
      expect(navigation.open).toHaveBeenCalledWith('/e/acme/invoices/inv-1', 'side');
      item('copy-link').run!({} as never);
      expect(navigation.copyLink).toHaveBeenCalledWith('/e/acme/invoices/inv-1');
    });

    it('opens from the keyboard too (Shift+F10 on the row link)', () => {
      const { el } = render();
      el.querySelector('a')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
      expect(opened).not.toBeNull();
    });
  });
});
