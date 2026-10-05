import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { StockTransferFormPage } from './transfer-form.page';
import { StockService, StockTransfer } from '../data/stock.service';
import { InventoryService } from '../../../core/api/inventory.service';
import { WarehousesService } from '../../masters/data/warehouses.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';

/** A transfer moves stock between two different warehouses and only quantities above zero. */
describe('StockTransferFormPage', () => {
  const warehouses = [
    { id: 'a', name: 'A', code: 'A', isActive: true, isDefault: true },
    { id: 'b', name: 'B', code: 'B', isActive: true, isDefault: false },
    { id: 'closed', name: 'C', code: 'C', isActive: false, isDefault: false },
  ];
  const draft: StockTransfer = {
    id: 't-1', number: 'TR-2026-00001', date: '2026-10-01', fromWarehouseId: 'a', fromWarehouseName: 'A',
    toWarehouseId: 'b', toWarehouseName: 'B', notes: null, status: 'DRAFT', postedAt: null,
    lines: [{ productId: 'p1', quantity: 3, available: 5 }],
  };
  let stock: Record<string, jest.Mock>;
  const confirm = jest.fn().mockResolvedValue(true);

  function create(inputs: Record<string, string> = {}) {
    stock = {
      onHand: jest.fn().mockReturnValue(of({ items: [{ quantityOnHand: 5 }], total: 1, page: 1, limit: 1, pages: 1, totalValue: 0 })),
      transfer: jest.fn().mockReturnValue(of(draft)),
      createTransfer: jest.fn().mockReturnValue(of(draft)),
      updateTransfer: jest.fn().mockReturnValue(of(draft)),
      postTransfer: jest.fn().mockReturnValue(of({ ...draft, status: 'POSTED' })),
      cancelTransfer: jest.fn().mockReturnValue(of({ ...draft, status: 'CANCELLED' })),
    };
    TestBed.configureTestingModule({
      imports: [StockTransferFormPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: StockService, useValue: stock },
        { provide: InventoryService, useValue: { searchProducts: () => of([]), getProductById: (id: string) => of({ id, name: id }) } },
        { provide: WarehousesService, useValue: { list: () => of(warehouses) } },
        { provide: DialogService, useValue: { confirm } },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showHttpError: jest.fn(), showError: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
      ],
    });
    const fixture = TestBed.createComponent(StockTransferFormPage);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('offers only open warehouses', () => {
    const page = create();
    expect(page.warehouses().map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('refuses the same warehouse on both ends', () => {
    const page = create();
    page.form.patchValue({ fromWarehouseId: 'a', toWarehouseId: 'a' });
    page.lines.at(0).patchValue({ productId: 'p1', quantity: 1 });
    page.save();
    expect(stock['createTransfer']).not.toHaveBeenCalled();
    expect(page.problems().map((p) => p.message)).toContain('inventory.transfers.same_warehouse');
  });

  it('refuses a line without a positive quantity', () => {
    const page = create();
    page.form.patchValue({ fromWarehouseId: 'a', toWarehouseId: 'b' });
    page.lines.at(0).patchValue({ productId: 'p1', quantity: 0 });
    page.save();
    expect(stock['createTransfer']).not.toHaveBeenCalled();
    expect(page.problems().map((p) => p.message)).toContain('inventory.transfers.line_needs_quantity');
  });

  it('saves a valid draft', () => {
    const page = create();
    page.form.patchValue({ fromWarehouseId: 'a', toWarehouseId: 'b' });
    page.lines.at(0).patchValue({ productId: 'p1', quantity: 3 });
    page.save();
    expect(stock['createTransfer']).toHaveBeenCalledWith(
      expect.objectContaining({ fromWarehouseId: 'a', toWarehouseId: 'b', lines: [{ productId: 'p1', quantity: 3 }] }),
    );
  });

  it('posts a draft and locks it', async () => {
    const page = create({ id: 't-1' });
    await page.post();
    expect(stock['postTransfer']).toHaveBeenCalledWith('t-1');
    expect(page.editable()).toBe(false);
  });
});
