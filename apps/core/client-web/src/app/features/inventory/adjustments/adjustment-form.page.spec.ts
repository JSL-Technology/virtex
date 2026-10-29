import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { of, throwError } from 'rxjs';
import { InventoryAdjustmentFormPage } from './adjustment-form.page';
import { InventoryAdjustment, StockService } from '../data/stock.service';
import { InventoryService } from '../../../core/api/inventory.service';
import { WarehousesService } from '../../masters/data/warehouses.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';

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
  const confirmClose = jest.fn().mockResolvedValue('discard');
  let permitted = true;

  beforeEach(() => {
    permitted = true;
    localStorage.clear();
    confirm.mockClear();
    confirmClose.mockClear();
  });

  function create(inputs: Record<string, string> = {}) {
    stock = {
      onHand: jest.fn().mockReturnValue(of({ items: [{ quantityOnHand: 10 }], total: 1, page: 1, limit: 1, pages: 1, totalValue: 0 })),
      adjustment: jest.fn().mockReturnValue(of(draft)),
      createAdjustment: jest.fn().mockReturnValue(of(draft)),
      updateAdjustment: jest.fn().mockReturnValue(of(draft)),
      postAdjustment: jest.fn().mockReturnValue(of({ ...draft, status: 'POSTED', journalEntryId: 'je-1' })),
      cancelAdjustment: jest.fn().mockReturnValue(of({ ...draft, status: 'CANCELLED' })),
      reverseAdjustment: jest.fn(),
      adjustmentDateReadiness: jest.fn().mockReturnValue(of({ period: { name: 'Octubre 2026', open: true }, problem: null, params: {} })),
    };
    notifications = { showSuccess: jest.fn(), showHttpError: jest.fn(), showError: jest.fn() };
    TestBed.configureTestingModule({
      imports: [InventoryAdjustmentFormPage],
      providers: [
        provideRouter([]),
        { provide: StockService, useValue: stock },
        {
          provide: InventoryService,
          useValue: { searchProducts: () => of([]), getProductById: (id: string) => of({ id, name: id, sku: id.toUpperCase(), cost: 5, stock: 10, unitOfMeasure: 'UND', status: 'Active' }) },
        },
        { provide: WarehousesService, useValue: { list: () => of(warehouses) } },
        { provide: DialogService, useValue: { confirm, confirmClose } },
        { provide: AuthService, useValue: { hasPermissions: () => permitted } },
        { provide: NotificationService, useValue: notifications },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path, slug: signal('acme') } },
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
    expect(page.problems()).toContainEqual(expect.objectContaining({ message: 'inventory.adjustments.repeated_product_lines', params: { lines: '1, 2' } }));
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
        // The balance the screen showed goes with the count, so the posting can tell if it moved.
        lines: [{ productId: 'p1', countedQuantity: 8, expectedQuantity: 10, quantityChange: null, unitCost: null, newUnitCost: null }],
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
    expect(stock['postAdjustment']).toHaveBeenCalledWith('adj-1', undefined);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'inventory.adjustments.post_message_impact', messageParams: expect.objectContaining({ lines: 1 }) }));
    expect(page.status()).toBe('POSTED');
    expect(page.editable()).toBe(false);
    expect(page.form.disabled).toBe(true);
    expect(page.journalLink()).toBe('/accounting/journal-entries/je-1/edit');
  });

  it('shows the difference and the value each line will move, before posting', () => {
    const page = create({ productId: 'p1' });
    page.lines.at(0).patchValue({ countedQuantity: 8 });
    // 10 on hand, 8 counted, average cost 5: two missing, worth 10.
    expect(page.figures()[0]).toEqual({ difference: -2, quantityValue: -10, revaluationValue: 0 });
    expect(page.impact()).toEqual(expect.objectContaining({ shortfall: -10, surplus: 0, revaluation: 0, net: -10, lines: 1 }));

    page.lines.at(0).patchValue({ countedQuantity: null, quantityChange: null, newUnitCost: 6 });
    expect(page.figures()[0].revaluationValue).toBe(10);
  });

  it('names a line without a product by its label and line, not by the control', () => {
    const page = create();
    page.form.patchValue({ reason: 'Conteo físico' });
    page.save();
    expect(page.problems()).toContainEqual(
      expect.objectContaining({ message: 'shell.problem_required_line', fieldId: 'adj-line-0-productId', params: expect.objectContaining({ field: 'inventory.common.product', line: 1 }) }),
    );
    expect(page.problems().map((p) => p.message)).not.toContain('inventory.adjustments.line_needs_product');
  });

  it('drops a problem from the summary as soon as it is fixed', () => {
    const page = create({ productId: 'p1' });
    page.save();
    expect(page.problems().length).toBeGreaterThan(0);
    page.form.patchValue({ reason: 'Conteo físico' });
    page.lines.at(0).patchValue({ countedQuantity: 8 });
    expect(page.problems()).toEqual([]);
  });

  it('is read only for someone who may view adjustments but not make them', () => {
    permitted = false;
    const page = create({ id: 'adj-1' });
    expect(page.editable()).toBe(false);
    expect(page.form.disabled).toBe(true);
    void page.post();
    expect(stock['postAdjustment']).not.toHaveBeenCalled();
  });

  it('turns a moved balance into a decision instead of an error, and posts with it', async () => {
    const page = create({ id: 'adj-1' });
    const conflict = { productId: 'p1', productName: 'Tornillo', sku: 'T1', counted: 8, expected: 10, current: 0 };
    stock['postAdjustment'].mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 409, error: { messageKey: 'inventory.adjustment_balance_changed', params: { lines: [conflict] } } })),
    );
    await page.post();
    expect(page.conflicts()).toEqual([conflict]);
    expect(notifications['showHttpError']).not.toHaveBeenCalled();

    await page.post('keep_difference');
    expect(stock['postAdjustment']).toHaveBeenLastCalledWith('adj-1', 'keep_difference');
    expect(page.conflicts()).toBeNull();
  });

  it('asks before «Cancel» throws away unsaved changes', async () => {
    const page = create({ productId: 'p1' });
    page.form.markAsDirty();
    confirmClose.mockResolvedValueOnce('cancel');
    await page.cancel();
    expect(confirmClose).toHaveBeenCalled();
    expect(page.form.dirty).toBe(true);
  });

  it('keeps unsaved work in the browser and offers it back', async () => {
    jest.useFakeTimers();
    const first = create({ productId: 'p1' });
    first.form.patchValue({ reason: 'Conteo que no debe perderse' });
    first.form.markAsDirty();
    first.form.patchValue({ notes: 'nota' });
    jest.advanceTimersByTime(500);
    jest.useRealTimers();

    // A new window on the same document, as after a reload.
    const fixture = TestBed.createComponent(InventoryAdjustmentFormPage);
    fixture.detectChanges();
    const second = fixture.componentInstance;
    expect(second.recovered()).not.toBeNull();
    second.restoreRecovered();
    expect(second.form.value.reason).toBe('Conteo que no debe perderse');
    expect(second.recovered()).toBeNull();
  });
});
