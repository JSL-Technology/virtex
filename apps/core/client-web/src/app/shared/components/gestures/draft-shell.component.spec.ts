import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem } from './draft-shell.component';

/**
 * Changing a draft is the gesture where work gets lost.
 *
 * A form that does not say whether there are unsaved changes leaves that count to the user, and the
 * answer they give themselves — "I think I saved it" — is the one that produces the support call.
 * These tests pin the three things that prevent it: the state is stated in words, the actions do
 * not scroll away, and a refused save says what is missing instead of greying out.
 */
@Component({
  standalone: true,
  imports: [DraftShellComponent],
  template: `
    <vx-draft-shell
      [title]="title()"
      [dirty]="dirty()"
      [saving]="saving()"
      [invalid]="invalid()"
      [problems]="problems()"
      [error]="error()"
      (save)="saves = saves + 1"
      (cancel)="cancels = cancels + 1"
      (focusField)="focused = $event"
    >
      <input class="field" id="ncf" />
    </vx-draft-shell>
  `,
})
class Host {
  readonly title = signal('Nueva factura');
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly invalid = signal(false);
  readonly problems = signal<DraftProblem[]>([]);
  readonly error = signal<string | null>(null);
  saves = 0;
  cancels = 0;
  focused = '';
}

describe('DraftShellComponent', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host, TranslateModule.forRoot()],
    }).compileComponents();

    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('dice el estado en palabras y lo anuncia al cambiar', () => {
    // `aria-live`: the state changes with no visible action of the user's, and it is precisely the
    // fact that must not live only in a coloured dot.
    const status = el.querySelector('.dr__status') as HTMLElement;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('SHELL.NO_CHANGES');

    host.dirty.set(true);
    fixture.detectChanges();
    expect(el.querySelector('.dr__status')?.textContent).toContain('SHELL.UNSAVED');

    host.saving.set(true);
    fixture.detectChanges();
    expect(el.querySelector('.dr__status')?.textContent).toContain('SHELL.SAVING');
  });

  it('guardar sigue habilitado con el formulario inválido', () => {
    // A greyed-out button does not say what is missing: the user hunts for the guilty field, which
    // is usually off screen. Pressing and getting the summary answers it in one click.
    host.invalid.set(true);
    fixture.detectChanges();

    const save = el.querySelector('.dr__save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    save.click();
    expect(host.saves).toBe(1);
  });

  it('mientras guarda no se puede volver a enviar', () => {
    // The one thing a second click really breaks: two records instead of one.
    host.saving.set(true);
    fixture.detectChanges();

    expect((el.querySelector('.dr__save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('el resumen de errores se anuncia y lleva al campo', () => {
    host.problems.set([{ message: 'FALTA_NCF', fieldId: 'ncf' }, { message: 'FALTA_CLIENTE' }]);
    fixture.detectChanges();

    const banner = el.querySelector('.dr__banner--problems');
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(el.querySelectorAll('.dr__problems li').length).toBe(2);

    (el.querySelector('.dr__problem-link') as HTMLButtonElement).click();
    expect(host.focused).toBe('ncf');
  });

  it('un problema sin campo no finge que se puede saltar a él', () => {
    host.problems.set([{ message: 'FALTA_CLIENTE' }]);
    fixture.detectChanges();

    expect(el.querySelector('.dr__problem-link')).toBeNull();
    expect(el.querySelector('.dr__problems li')?.textContent?.trim()).toBe('FALTA_CLIENTE');
  });

  it('el error del servidor se muestra aparte de las validaciones', () => {
    // They are different things: one is "lo que escribiste no vale", the other "el servidor lo
    // rechazó". Merging them hides which of the two the user can fix.
    host.error.set('Periodo contable cerrado');
    host.problems.set([{ message: 'FALTA_NCF' }]);
    fixture.detectChanges();

    expect(el.querySelector('.dr__banner--error')?.textContent).toContain('Periodo contable cerrado');
    expect(el.querySelector('.dr__banner--problems')).not.toBeNull();
  });

  it('enviar el formulario guarda, y cancelar cancela', () => {
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    expect(host.saves).toBe(1);

    (el.querySelector('.dr__cancel') as HTMLButtonElement).click();
    expect(host.cancels).toBe(1);
  });

  it('proyecta el formulario de la página', () => {
    expect(el.querySelector('.dr__body .field')).not.toBeNull();
  });
});
