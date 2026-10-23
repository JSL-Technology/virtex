import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ModuleRailComponent } from './module-rail.component';
import { ActiveModuleService, ReachableModule } from '../../core/modules/active-module.service';
import { ModuleInboxService } from '../../core/inbox/module-inbox.service';
import { MODULES } from '../../core/modules/module-registry';
import { ModuleManifest } from '../../core/modules/module-manifest';
import { provideTranslateService } from '@ngx-translate/core';

/**
 * The rail is the first decision of every navigation: which part of the business.
 *
 * What these tests defend is not the drawing. It is that a module the user cannot enter still
 * appears — hidden means unknown, and a customer who cannot see that a module exists asks support
 * instead of asking sales — and that choosing one shows its panel without opening anything.
 */
describe('ModuleRailComponent', () => {
  let fixture: ComponentFixture<ModuleRailComponent>;
  const browse = jest.fn();

  const ventas = MODULES.find((m) => m.id === 'ventas') as ModuleManifest;
  const compras = MODULES.find((m) => m.id === 'compras') as ModuleManifest;

  /** Lo pendiente por módulo, como lo devolvería el servidor. */
  let pendientes: Record<string, number> = {};

  async function render(
    reachable: ReachableModule[],
    active: ModuleManifest | null,
    current: ModuleManifest | null = active,
  ) {
    browse.mockReset();
    await TestBed.configureTestingModule({
      imports: [ModuleRailComponent],
      providers: [
        provideTranslateService(),
        {
          provide: ActiveModuleService,
          useValue: {
            reachable: signal(reachable).asReadonly(),
            active: signal(active).asReadonly(),
            current: signal(current).asReadonly(),
            isBrowsing: signal(active?.id !== current?.id).asReadonly(),
            browse,
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

  // QA M-01: a padlocked module still advertised screens the seat could not open, and every click
  // on one ended in "access denied". The rail shows a role its own work.
  it('no muestra los módulos en los que el puesto no puede entrar', async () => {
    const el = await render(
      [
        { module: ventas, allowed: true, target: '/invoices' },
        { module: compras, allowed: false, target: null },
      ],
      ventas,
    );

    const items = el.querySelectorAll('.rail__item');
    expect(items.length).toBe(1);
    expect(el.querySelector('.rail__item--locked')).toBeNull();
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
    expect(activos[0].getAttribute('aria-pressed')).toBe('true');
    // Sin explorar otro módulo no hay segunda marca: la ventana está en el módulo activo.
    expect(el.querySelector('.rail__current')).toBeNull();
  });

  it('elegir un módulo enseña su panel y no abre nada', async () => {
    // Cada módulo mirado dejaba una pestaña —la de su primera pantalla, rara vez la buscada—. El
    // riel ahora solo cambia el panel; qué abrir lo decide el usuario desde ahí.
    const el = await render([{ module: compras, allowed: true, target: '/purchase-orders' }], ventas);

    (el.querySelector('.rail__item') as HTMLButtonElement).click();

    expect(browse).toHaveBeenCalledWith(compras);
  });

  it('mientras se explora otro módulo, marca aparte el de la ventana abierta', async () => {
    const el = await render(
      [
        { module: ventas, allowed: true, target: '/invoices' },
        { module: compras, allowed: true, target: '/purchase-orders' },
      ],
      compras, // el panel enseña Compras…
      ventas, // …y la ventana es de Ventas
    );

    const actual = el.querySelector('.rail__item--current');
    expect(actual?.textContent).toContain(ventas.titleKey);
    expect(actual?.querySelector('.rail__current')).not.toBeNull();
    expect(el.querySelector('.rail__item--active')?.textContent).toContain(compras.titleKey);
  });

  it('no ofrece ninguna puerta a un módulo bloqueado', async () => {
    const el = await render([{ module: compras, allowed: false, target: null }], ventas);

    expect(el.querySelector('.rail__item')).toBeNull();
    expect(browse).not.toHaveBeenCalled();
  });
});
