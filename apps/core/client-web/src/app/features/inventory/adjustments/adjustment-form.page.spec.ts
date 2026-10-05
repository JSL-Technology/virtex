import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { InventoryAdjustmentFormPage } from './adjustment-form.page';
import { InventoryAdjustment, StockService } from '../data/stock.service';
import { InventoryService } from '../../../core/api/inventory.service';
import { WarehousesService } from '../../masters/data/warehouses.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';

/**
 * An adjustment is a document: drafted, validated line by line, then posted. The stock it moves is
 * computed by the server from the counted quantity against the warehouse's balance, so the screen
 * sends a count OR a change, never both, and shows the balance it is counting against.
 */
describe('InventoryAdjustmentFormPage', () => {
  const warehouses = [
    { id: 'w-old', name: 'Viejo', code: 'V', isActive: true, isDefault: false },
    { id: 'w-main', name: 'Principal', code: 'P', isActive: true, isDefault: true },
  ];
  const draft: InventoryAdjustment = {
    id: 'adj-1', number: 'AJ-2026-00001', date: '2026-10-01', warehouseId: 'w-main', warehouseName: 'Principal',
    reason: 'Conteo', notes: null, status: 'DRAFT', valueChange: null, journalEntryId: null, postedAt: null,
    lines: [{ productId: 'p1', countedQuantity: 8, quantityChange: 0, unitCost: null, newUnitCost: null, onHand: 10 }],
  };

  let stock: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;
  const confirm = jest.fn().mockResolvedValue(true);

  function create(inputs: Record<string, string> = {}) {
    stock = {
      onHand: jest.fn().mockReturnValue(of({ items: [{ quantityOnHand: 10 }], total: 1, page: 1, limit: 1, pages: 1, totalValue: 0 })),
      adjustment: jest.fn().mockReturnValue(of(draft)),
      createAdjustment: jest.fn().mockReturnValue(of(draft)),
      updateAdjustment: jest.fn().mockReturnValue(of(draft)),
      postAdjustment: jest.fn().mockReturnValue(of({ ...draft, status: 'POSTED', journalEntryId: 'je-1' })),
      cancelAdjustment: jest.fn().mockReturnValue(of({ ...draft, status: 'CANCELLED' })),
    };
    notifications = { showSuccess: jest.fn(), showHttpError: jest.fn(), showError: jest.fn() };
    TestBed.configureTestingModule({
      imports: [InventoryAdjustmentFormPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: StockService, useValue: stock },
        { provide: InventoryService, useValue: { searchProducts: () => of([]), getProductById: (id: string) => of({ id, name: id }) } },
        { provide: WarehousesService, useValue: { list: () => of(warehouses) } },
        { provide: DialogService, useValue: { confirm } },
        { provide: NotificationService, useValue: notifications },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
      ],
    });
    const fixture = TestBed.createComponent(InventoryAdjustmentFormPage);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('starts in the default warehouse with the product it was opened for, and shows what it holds', () => {
    const page = create({ productId: 'p1' });
    expect(page.form.value.warehouseId).toBe('w-main');
    expect(page.lines.length).toBe(1);
    expect(page.lines.at(0).value.productId).toBe('p1');
    expect(stock['onHand']).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', warehouseId: 'w-main' }));
    expect(page.onHand()[0]).toBe(10);
  });

  it('refuses a line with both a count and a change, and a line with neither', () => {
    const page = create({ productId: 'p1' });
    page.form.patchValue({ reason: 'Conteo físico' });
    page.lines.at(0).patchValue({ countedQuantity: 8, quantityChange: -2 });
    page.save();
    expect(stock['createAdjustment']).not.toHaveBeenCalled();
    expect(page.problems().map((p) => p.message)).toContain('inventory.adjustments.line_count_or_change');

    page.lines.at(0).patchValue({ countedQuantity: null, quantityChange: null });
    page.save();
    expect(page.problems().map((p) => p.message)).toContain('inventory.adjustments.line_empty');
  });

  it('refuses the same product on two lines', () => {
    const page = create({ productId: 'p1' });
    page.form.patchValue({ reason: 'Conteo físico' });
    page.lines.at(0).patchValue({ countedQuantity: 8 });
    page.addLine('p1');
    page.lines.at(1).patchValue({ quantityChange: -1 });
    page.save();
    expect(page.problems().map((p) => p.message)).toContain('inventory.common.repeated_product');
  });

  it('sends a counted line as a count only, never with a change', () => {
    const page = create({ productId: 'p1' });
    page.form.patchValue({ reason: '  Conteo físico  ' });
    page.lines.at(0).patchValue({ countedQuantity: 8 });
    page.save();
    expect(stock['createAdjustment']).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId: 'w-main',
        reason: 'Conteo físico',
        lines: [{ productId: 'p1', countedQuantity: 8, quantityChange: null, unitCost: null, newUnitCost: null }],
      }),
    );
    expect(notifications['showSuccess']).toHaveBeenCalledWith('inventory.adjustments.saved', { number: 'AJ-2026-00001' });
  });

  it('posts an existing draft after confirmation and becomes read-only', async () => {
    const page = create({ id: 'adj-1' });
    expect(page.editable()).toBe(true);
    expect(page.onHand()[0]).toBe(10);
    await page.post();
    expect(confirm).toHaveBeenCalled();
    expect(stock['postAdjustment']).toHaveBeenCalledWith('adj-1');
    expect(page.status()).toBe('POSTED');
    expect(page.editable()).toBe(false);
    expect(page.form.disabled).toBe(true);
    expect(page.journalLink()).toBe('/accounting/journal-entries/je-1/edit');
  });
});
