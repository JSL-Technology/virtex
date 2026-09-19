import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { VxDialogComponent, VxDialogDismissal } from './index';

@Component({
  standalone: true,
  imports: [TranslateModule, VxDialogComponent],
  template: `
    <button type="button" id="opener" (click)="open.set(true)">Abrir</button>

    @if (open()) {
      <vx-dialog
        titleKey="common.confirmation"
        [busy]="busy()"
        [closeOnScrim]="closeOnScrim()"
        (dismissed)="dismiss($event)"
      >
        <input id="first" />
        <input id="second" />
        <ng-container dialogActions>
          <button type="button" id="save">Guardar</button>
        </ng-container>
      </vx-dialog>
    }
  `,
})
class Host {
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly closeOnScrim = signal(true);
  readonly reasons = signal<VxDialogDismissal[]>([]);

  dismiss(reason: VxDialogDismissal): void {
    this.reasons.update((all) => [...all, reason]);
    this.open.set(false);
  }
}

describe('VxDialogComponent', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  /**
   * Abrir y dejar que el CDK termine.
   *
   * `cdkTrapFocusAutoCapture` coloca el foco cuando la zona se estabiliza, no en el mismo tic en
   * que se adjunta el overlay — así que sin esta espera se comprueba el estado de un diálogo que
   * todavía se está montando.
   */
  function open(): void {
    (document.getElementById('opener') as HTMLButtonElement).focus();
    (document.getElementById('opener') as HTMLButtonElement).click();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  }

  function panel(): HTMLElement | null {
    return document.querySelector('.vx-dialog__panel');
  }

  function escape(): void {
    panel()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
  }

  it('se declara como diálogo modal con nombre', fakeAsync(() => {
    open();
    const dialog = panel() as HTMLElement;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    //  Un diálogo sin nombre accesible es, para un lector de pantalla, «diálogo».
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent?.trim()).toBeTruthy();
    flush();
  }));

  it('captura el foco al abrirse', fakeAsync(() => {
    //  Ninguno de los nueve diálogos que esto sustituye lo hacía: con uno abierto, el tabulador
    //  se iba a la página de detrás.
    open();
    expect(panel()?.contains(document.activeElement)).toBe(true);
    flush();
  }));

  it('devuelve el foco a quien lo abrió', fakeAsync(() => {
    open();
    expect(document.activeElement?.id).not.toBe('opener');

    escape();
    expect(document.activeElement?.id).toBe('opener');
    flush();
  }));

  it('cierra con Escape y dice por qué', fakeAsync(() => {
    open();
    escape();
    expect(fixture.componentInstance.reasons()).toEqual(['escape']);
    expect(panel()).toBeNull();
    flush();
  }));

  it('cierra con el botón de cerrar', fakeAsync(() => {
    open();
    (document.querySelector('.vx-dialog__close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.reasons()).toEqual(['close-button']);
    flush();
  }));

  it('cierra al pulsar fuera, y deja de hacerlo si se le dice', fakeAsync(() => {
    open();
    (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.reasons()).toEqual(['scrim']);

    fixture.componentInstance.closeOnScrim.set(false);
    open();
    (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.reasons()).toEqual(['scrim']);
    expect(panel()).not.toBeNull();
    flush();
  }));

  it('no se deja cerrar mientras algo está en vuelo', fakeAsync(() => {
    //  Un diálogo que se desvanece a mitad de un guardado deja al lector sin saber si guardó.
    fixture.componentInstance.busy.set(true);
    open();

    escape();
    (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.reasons()).toEqual([]);
    expect((document.querySelector('.vx-dialog__close') as HTMLButtonElement).disabled).toBe(true);
    flush();
  }));

  it('proyecta el pie solo cuando hay acciones', fakeAsync(() => {
    open();
    const footer = document.querySelector('.vx-dialog__footer') as HTMLElement;
    expect(footer.classList).not.toContain('is-empty');
    expect(footer.querySelector('#save')).not.toBeNull();
    flush();
  }));

  it('se lleva su overlay al destruirse', fakeAsync(() => {
    open();
    expect(panel()).not.toBeNull();
    fixture.destroy();
    expect(panel()).toBeNull();
    flush();
  }));
});
