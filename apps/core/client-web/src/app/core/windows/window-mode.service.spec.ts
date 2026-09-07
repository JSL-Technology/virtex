import { TestBed } from '@angular/core/testing';
import { WindowModeService } from './window-mode.service';

/**
 * El modo compacto no es una preferencia.
 *
 * En 600 px de ancho no caben dos ventanas, así que ofrecer que se dividan sería ofrecer algo que
 * no funciona. Se impone por el tamaño, y lo que el usuario eligió se guarda aparte para
 * devolvérselo cuando el espacio vuelve — que es la parte que se olvida y la que estas pruebas
 * fijan.
 */
describe('WindowModeService', () => {
  function widthOf(width: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  }

  function make(): WindowModeService {
    TestBed.configureTestingModule({});
    return TestBed.inject(WindowModeService);
  }

  beforeEach(() => {
    localStorage.clear();
    widthOf(1440);
    TestBed.resetTestingModule();
  });

  it('empieza enfocado: una ventana a la vista', () => {
    expect(make().mode()).toBe('focused');
  });

  it('el taller permite varias ventanas; el modo enfocado no', () => {
    const modes = make();
    expect(modes.canTile()).toBe(false);

    modes.set('workshop');
    expect(modes.mode()).toBe('workshop');
    expect(modes.canTile()).toBe(true);
  });

  it('recuerda la elección entre sesiones', () => {
    make().set('workshop');
    TestBed.resetTestingModule();

    expect(make().mode()).toBe('workshop');
  });

  it('una pantalla estrecha impone compacto sin borrar lo elegido', () => {
    // Lo que se guarda es la preferencia, no el modo efectivo: guardar «compacto» haría que el
    // usuario volviera a su escritorio con el modo equivocado.
    localStorage.setItem('virtex.windowMode', 'workshop');
    widthOf(600);
    const modes = make();

    expect(modes.mode()).toBe('compact');
    expect(modes.canTile()).toBe(false);
    expect(modes.showsTabs()).toBe(false);
    expect(localStorage.getItem('virtex.windowMode')).toBe('workshop');
  });

  it('al ensanchar la ventana devuelve el modo que el usuario había elegido', () => {
    localStorage.setItem('virtex.windowMode', 'workshop');
    widthOf(600);
    const modes = make();
    expect(modes.mode()).toBe('compact');

    widthOf(1440);
    window.dispatchEvent(new Event('resize'));

    expect(modes.mode()).toBe('workshop');
  });

  it('alternar va y viene entre enfocado y taller', () => {
    const modes = make();
    modes.toggle();
    expect(modes.mode()).toBe('workshop');
    modes.toggle();
    expect(modes.mode()).toBe('focused');
  });
});
