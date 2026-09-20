import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ModuleRailComponent } from './module-rail.component';
import { ActiveModuleService, ReachableModule } from '../../core/modules/active-module.service';
import { ModuleInboxService } from '../../core/inbox/module-inbox.service';
import { MODULES } from '../../core/modules/module-registry';
import { ModuleManifest } from '../../core/modules/module-manifest';

/**
 * The rail is the first decision of every navigation: which part of the business.
 *
 * What these tests defend is not the drawing. It is that a module the user cannot enter still
 * appears — hidden means unknown, and a customer who cannot see that a module exists asks support
 * instead of asking sales — and that clicking one never navigates somewhere the server will refuse.
 */
describe('ModuleRailComponent', () => {
  let fixture: ComponentFixture<ModuleRailComponent>;
  const navigateByUrl = jest.fn();

  const ventas = MODULES.find((m) => m.id === 'ventas') as ModuleManifest;
  const compras = MODULES.find((m) => m.id === 'compras') as ModuleManifest;

  /** Lo pendiente por módulo, como lo devolvería el servidor. */
  let pendientes: Record<string, number> = {};

  async function render(reachable: ReachableModule[], active: ModuleManifest | null) {
    navigateByUrl.mockReset();
    await TestBed.configureTestingModule({
      imports: [ModuleRailComponent, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: { navigateByUrl } },
        {
          provide: ActiveModuleService,
          useValue: {
            reachable: signal(reachable).asReadonly(),
            active: signal(active).asReadonly(),
          },
        },
        {
          provide: ModuleInboxService,
          useValue: { countFor: (id: string) => pendientes[id] ?? 0 },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ModuleRailComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    pendientes = {};
  });

  afterEach(() => TestBed.resetTestingModule());

  it('pone el número de lo pendiente sobre el módulo que lo tiene', async () => {
    pendientes = { ventas: 3 };
    const el = await render(
      [
        { module: ventas, allowed: true, target: '/invoices' },
        { module: compras, allowed: true, target: '/accounts-payable' },
      ],
      ventas,
    );

    const insignias = el.querySelectorAll('.rail__badge');
    expect(insignias).toHaveLength(1);
    expect(insignias[0].textContent?.trim()).toBe('3');
  });

  it('un módulo bloqueado no lleva número', async () => {
    // Decir que hay tres cosas pendientes detrás de un candado es enseñar el tamaño de algo que
    // no se puede abrir.
    pendientes = { compras: 7 };
    const el = await render(
      [{ module: compras, allowed: false, target: null }],
      null,
    );

    expect(el.querySelectorAll('.rail__badge')).toHaveLength(0);
  });

  it('a partir de cien dice 99+, porque tres cifras deforman un riel de 64px', async () => {
    pendientes = { ventas: 240 };
    const el = await render([{ module: ventas, allowed: true, target: '/invoices' }], ventas);

    expect(el.querySelector('.rail__badge')?.textContent?.trim()).toBe('99+');
  });

  it('sin nada pendiente no dibuja ninguna insignia', async () => {
    const el = await render([{ module: ventas, allowed: true, target: '/invoices' }], ventas);

    expect(el.querySelectorAll('.rail__badge')).toHaveLength(0);
  });

  it('muestra los módulos sin permiso, apagados, en vez de esconderlos', async () => {
    const el = await render(
      [
        { module: ventas, allowed: true, target: '/invoices' },
        { module: compras, allowed: false, target: null },
      ],
      ventas,
    );

    const items = el.querySelectorAll('.rail__item');
    expect(items.length).toBe(2);
    expect(items[1].classList.contains('rail__item--locked')).toBe(true);
    expect(items[1].getAttribute('aria-disabled')).toBe('true');
    expect(items[1].querySelector('.rail__lock')).not.toBeNull();
  });

  it('marca el módulo activo, y solo uno', async () => {
    const el = await render(
      [
        { module: ventas, allowed: true, target: '/invoices' },
        { module: compras, allowed: true, target: '/purchase-orders' },
      ],
      compras,
    );

    const activos = el.querySelectorAll('.rail__item--active');
    expect(activos.length).toBe(1);
    expect(activos[0].getAttribute('aria-current')).toBe('page');
  });

  it('abre el módulo por su primera entrada permitida', async () => {
    const el = await render([{ module: compras, allowed: true, target: '/purchase-orders' }], ventas);

    (el.querySelector('.rail__item') as HTMLButtonElement).click();

    expect(navigateByUrl).toHaveBeenCalledWith('/purchase-orders');
  });

  it('no navega a un módulo bloqueado', async () => {
    // The point of showing it is to inform, not to offer. A door the server will slam is worse
    // than no door: the user cannot tell a permission problem from a broken screen.
    const el = await render([{ module: compras, allowed: false, target: null }], ventas);

    (el.querySelector('.rail__item') as HTMLButtonElement).click();

    expect(navigateByUrl).not.toHaveBeenCalled();
  });
});
