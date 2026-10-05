import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { GoodsReceiptNewPage } from './receipt-new.page';
import { GoodsReceiptPage } from './receipt.page';
import { GoodsReceipt, PurchaseOrder, PurchasingService } from '../data/purchasing.service';
import { WarehousesService } from '../../masters/data/warehouses.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { provideTestBranches } from '../../../core/tenancy/branches.service.testing';

/**
 * A goods receipt is a document: recorded against an order with what is outstanding pre-filled,
 * never more than outstanding, and voidable from its own page only while none of it is billed.
 */
describe('goods receipts', () => {
  const order = {
    id: 'po-1',
    number: 'PO-2026-000001',
    supplierId: 's-1',
    supplier: { id: 's-1', name: 'Suplidora' },
    status: 'PARTIALLY_RECEIVED',
    currencyCode: 'DOP',
    lines: [
      { id: 'l-1', description: 'Papel', quantity: 10, receivedQuantity: 4, unitPrice: 230 },
      { id: 'l-2', description: 'Tóner', quantity: 2, receivedQuantity: 2, unitPrice: 3400 },
    ],
  } as unknown as PurchaseOrder;

  const receipt: GoodsReceipt = {
    id: 'gr-1', number: 'GR-2026-000001', status: 'POSTED', receivedAt: '2026-03-02T12:00:00.000Z', receivedByUserId: null,
    orderId: 'po-1', orderNumber: 'PO-2026-000001', supplierId: 's-1', supplierName: 'Suplidora', currencyCode: 'DOP',
    warehouseId: null, branchId: null, notes: null, journalEntryId: 'je-1', reversalJournalEntryId: null, voidReason: null,
    voidedAt: null, value: 920,
    lines: [{ lineId: 'l-1', productId: 'p-1', description: 'Papel', quantity: 4, unitCost: 230, value: 920, stocked: true, ordered: 10, receivedOnOrder: 4, billedOnOrder: 0 }],
  };

  let purchasing: Record<string, jest.Mock>;
  const confirmPrompt = jest.fn().mockResolvedValue('Llegó a otra empresa');

  function configure() {
    purchasing = {
      listOrders: jest.fn().mockReturnValue(of({ rows: [order], page: 1, pageSize: 200, total: 1, hasMore: false })),
      getOrder: jest.fn().mockReturnValue(of(order)),
      createReceipt: jest.fn().mockReturnValue(of(receipt)),
      receipt: jest.fn().mockReturnValue(of(receipt)),
      voidReceipt: jest.fn().mockReturnValue(of({ ...receipt, status: 'VOID', voidReason: 'Llegó a otra empresa' })),
    };
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideTestBranches(),
        { provide: PurchasingService, useValue: purchasing },
        { provide: WarehousesService, useValue: { list: () => of([{ id: 'w-1', name: 'Principal', isActive: true, isDefault: true }]) } },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: () => 'x' } },
        { provide: DialogService, useValue: { prompt: confirmPrompt } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
        { provide: AuthService, useValue: { isAuthenticated$: of(true), getPermissions$: () => of(['procurement:manage']), hasPermissions: () => true } },
      ],
    });
  }

  describe('recording one', () => {
    function create() {
      configure();
      const fixture = TestBed.createComponent(GoodsReceiptNewPage);
      fixture.componentRef.setInput('orderId', 'po-1');
      fixture.detectChanges();
      return fixture.componentInstance;
    }

    it('opens on the order it came from, offering only what is outstanding, pre-filled', () => {
      const page = create();
      expect(purchasing['listOrders']).toHaveBeenCalledWith(1, 200, null, { receivable: true });
      expect(page.form.value.orderId).toBe('po-1');
      expect(page.lines.length).toBe(1);
      expect(page.lines.at(0).value).toMatchObject({ lineId: 'l-1', outstanding: 6, quantity: 6 });
    });

    it('refuses more than is outstanding and sends nothing', () => {
      const page = create();
      page.lines.at(0).patchValue({ quantity: 7 });
      page.save();
      expect(purchasing['createReceipt']).not.toHaveBeenCalled();
      expect(page.problems().map((p) => p.message)).toContain('purchasing.receipts.exceeds_outstanding');
    });

    it('records what arrived, where and when', () => {
      const page = create();
      page.form.patchValue({ receivedAt: '2026-03-02', warehouseId: 'w-1', notes: ' Conduce 55 ' });
      page.lines.at(0).patchValue({ quantity: 4 });
      page.save();
      expect(purchasing['createReceipt']).toHaveBeenCalledWith({
        orderId: 'po-1',
        receivedAt: '2026-03-02',
        warehouseId: 'w-1',
        notes: 'Conduce 55',
        lines: [{ lineId: 'l-1', quantity: 4 }],
      });
    });
  });

  describe('reading one', () => {
    function open(doc: GoodsReceipt = receipt) {
      configure();
      purchasing['receipt'].mockReturnValue(of(doc));
      const fixture = TestBed.createComponent(GoodsReceiptPage);
      fixture.componentRef.setInput('id', doc.id);
      fixture.detectChanges();
      return fixture.componentInstance;
    }

    it('voids an unbilled receipt after asking why', async () => {
      const page = open();
      expect(page.canVoid()).toBe(true);
      await page.voidReceipt();
      expect(purchasing['voidReceipt']).toHaveBeenCalledWith('gr-1', 'Llegó a otra empresa');
      expect(page.receipt()?.status).toBe('VOID');
      expect(page.canVoid()).toBe(false);
    });

    it('does not offer a void once any of it has been billed', () => {
      const page = open({ ...receipt, lines: [{ ...receipt.lines[0], billedOnOrder: 2 }] });
      expect(page.billed()).toBe(true);
      expect(page.canVoid()).toBe(false);
    });
  });
});
