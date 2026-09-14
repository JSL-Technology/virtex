import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { WarehousesPage } from './warehouses.page';
import { environment } from '../../../../environments/environment';

/**
 * The screen shows the tenant's warehouses, and can add one.
 *
 * It used to hold three invented sites with invented managers in a signal, make no request, and
 * offer a "New warehouse" button wired to nothing — while the `warehouses` table held zero rows and
 * `/wms/warehouses` had answered full CRUD the whole time. Someone configuring the company believed
 * they had three warehouses that stock could not be assigned to.
 *
 * The test that stood here asserted the component could be constructed, which was equally true of
 * the invented version.
 */
describe('Warehouses', () => {
  let component: WarehousesPage;
  let fixture: ComponentFixture<WarehousesPage>;
  let http: HttpTestingController;

  const API = `${environment.apiUrl}/wms/warehouses`;

  const warehouses = [
    { id: 'w1', name: 'Depósito Central', code: 'DC', isActive: true, city: 'Santo Domingo' },
    { id: 'w2', name: 'Depósito Norte', code: null, isActive: false, city: null },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [WarehousesPage] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WarehousesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const flushList = (rows = warehouses) => {
    http.expectOne(API).flush(rows);
    fixture.detectChanges();
  };

  it('asks the endpoint for the list instead of inventing one', () => {
    flushList();

    expect(component.warehouses().map((w) => w.name)).toEqual(['Depósito Central', 'Depósito Norte']);
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Depósito Central');
    // The sites and managers the screen used to invent regardless of what the tenant had.
    expect(text).not.toContain('Almacén Zona Franca');
    expect(text).not.toContain('Carlos Pérez');
  });

  it('shows an empty tenant as empty rather than as three warehouses', () => {
    flushList([]);

    expect(component.warehouses()).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('Almacén Principal');
  });

  it('reports a failed load and can retry', () => {
    http.expectOne(API).flush({ code: 'INTERNAL_ERROR' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(component.error()).toBeTruthy();

    component.load();
    flushList();
    expect(component.error()).toBeNull();
  });

  it('posts a new warehouse and reloads', () => {
    flushList();

    component.toggleCreate();
    component.draftName.set('  Depósito Este  ');
    component.draftCity.set('La Romana');
    fixture.detectChanges();

    expect(component.canSave()).toBe(true);
    component.save();

    const created = http.expectOne((r) => r.url === API && r.method === 'POST');
    expect(created.request.body).toEqual({
      name: 'Depósito Este',
      code: undefined,
      city: 'La Romana',
    });
    created.flush({ id: 'w3', name: 'Depósito Este', isActive: true, city: 'La Romana' });

    flushList();
    expect(component.creating()).toBe(false);
  });

  it('will not post a warehouse with no name', () => {
    flushList();
    component.toggleCreate();
    component.draftName.set('   ');

    expect(component.canSave()).toBe(false);
    component.save();
    http.expectNone((r) => r.method === 'POST');
  });
});
