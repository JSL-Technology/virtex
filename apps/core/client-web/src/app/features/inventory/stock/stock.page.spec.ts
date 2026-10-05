import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { StockPage } from './stock.page';
import { StockService } from '../data/stock.service';
import { WarehousesService } from '../../masters/data/warehouses.service';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';

/** Stock on hand reads the register per warehouse; the screen only filters and pages it. */
describe('StockPage', () => {
  const row = {
    productId: 'p1', sku: 'A-1', name: 'Tornillo', warehouseId: 'w1', warehouseName: 'Principal',
    quantityOnHand: 4, reorderLevel: 5, unitCost: 2, value: 8,
  };
  let onHand: jest.Mock;

  function create(warehouseId?: string) {
    TestBed.configureTestingModule({
      imports: [StockPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: StockService, useValue: { onHand } },
        { provide: WarehousesService, useValue: { list: () => of([]) } },
        { provide: NotificationService, useValue: { httpErrorMessage: () => 'falló' } },
        { provide: AuthService, useValue: { isAuthenticated$: of(true), getPermissions$: () => of([]), hasPermissions: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(StockPage);
    if (warehouseId) fixture.componentRef.setInput('warehouseId', warehouseId);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('opens on the warehouse in the URL and shows its rows and value', () => {
    onHand = jest.fn().mockReturnValue(of({ items: [row], total: 1, page: 1, limit: 100, pages: 1, totalValue: 8 }));
    const page = create('w1');
    expect(onHand).toHaveBeenCalledWith(expect.objectContaining({ warehouseId: 'w1', page: 1 }));
    expect(page.rows()).toEqual([row]);
    expect(page.totalValue()).toBe(8);
    expect((page as unknown as { belowReorder(r: typeof row): boolean }).belowReorder(row)).toBe(true);
  });

  it('a new search goes back to the first page', () => {
    onHand = jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, limit: 100, pages: 0, totalValue: 0 }));
    const page = create();
    page.goToPage(3);
    page.onSearch('torn');
    expect(onHand).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'torn', page: 1 }));
    expect(page.empty()).toBe(true);
  });

  it('says why it could not load', () => {
    onHand = jest.fn().mockReturnValue(throwError(() => new Error('boom')));
    const page = create();
    expect(page.error()).toBe('falló');
    expect(page.loading()).toBe(false);
  });
});
