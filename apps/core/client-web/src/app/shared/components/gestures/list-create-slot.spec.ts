import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { ListShellComponent } from './list-shell.component';

/**
 * Creating the FIRST record has to work, and that is the one state the default slot hides.
 *
 * `vx-list-shell` projects its default content only in the `content` case of the state switch, so
 * anything a page puts there vanishes while the list is empty. Four pages put their inline create
 * form exactly there — payroll runs, departments, payroll concepts and datasheets — and an empty
 * list is precisely the state a new tenant is in. The button toggled its signal, the form was never
 * rendered, and nothing failed: the click happened and the screen did not change, so a tenant could
 * not create the first payroll run, department or concept at all. Payroll was unusable end to end
 * for that reason alone.
 *
 * `[listCreate]` is projected outside the switch. These tests hold that line.
 */
@Component({
  standalone: true,
  imports: [ListShellComponent],
  template: `
    <vx-list-shell titleKey="test.title" [count]="count()" [empty]="empty()">
      <button listActions type="button" (click)="creating.set(!creating())">New</button>
      @if (creating()) {
        <div listCreate class="create-form" data-testid="create-form">
          <input type="text" />
        </div>
      }
      <div data-testid="rows">rows</div>
    </vx-list-shell>
  `,
})
class HostComponent {
  readonly creating = signal(false);
  readonly count = signal(0);
  readonly empty = signal(true);
}

describe('list shell create slot', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const createForm = () => fixture.nativeElement.querySelector('[data-testid="create-form"]');
  const rows = () => fixture.nativeElement.querySelector('[data-testid="rows"]');

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent, TranslateModule.forRoot()] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the create form while the list is empty', () => {
    expect(createForm()).toBeNull();

    host.creating.set(true);
    fixture.detectChanges();

    // The state is still `empty` — this is the case the default slot drops.
    expect(host.empty()).toBe(true);
    expect(createForm()).not.toBeNull();
  });

  it('still renders it once the list has rows', () => {
    host.empty.set(false);
    host.count.set(3);
    host.creating.set(true);
    fixture.detectChanges();

    expect(createForm()).not.toBeNull();
    expect(rows()).not.toBeNull();
  });

  it('keeps ordinary content out of the empty state, as before', () => {
    expect(rows()).toBeNull();

    host.empty.set(false);
    fixture.detectChanges();

    expect(rows()).not.toBeNull();
  });
});
