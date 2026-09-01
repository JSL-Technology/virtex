import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';
import { InvoicesListPage } from './list.page';
import { InvoicesService, PaginatedInvoices } from '../../../core/services/invoices';
import { NotificationService } from '../../../core/services/notification';

/**
 * The list asks the SERVER to filter and paginate.
 *
 * It used to fetch every invoice of the tenant on every visit and filter in memory, over a table
 * whose only index was its primary key.
 */
describe('InvoicesListPage', () => {
  let component: InvoicesListPage;
  let fixture: ComponentFixture<InvoicesListPage>;
  let invoicesService: { getInvoices: jest.Mock };
  let notifications: { showError: jest.Mock; showSuccess: jest.Mock };

  const page = (overrides: Partial<PaginatedInvoices> = {}): PaginatedInvoices => ({
    items: [],
    total: 0,
    page: 1,
    limit: 50,
    pages: 1,
    ...overrides,
  });

  beforeEach(async () => {
    invoicesService = { getInvoices: jest.fn().mockReturnValue(of(page())) };
    notifications = { showError: jest.fn(), showSuccess: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [InvoicesListPage],
      providers: [
        { provide: InvoicesService, useValue: invoicesService },
        { provide: NotificationService, useValue: notifications },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InvoicesListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('requests one page rather than the whole table', () => {
    expect(invoicesService.getInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 50 }),
    );
  });

  it('sends the search term to the server instead of filtering in memory', () => {
    component.searchTerm.set('FAC-0001');
    component.applyFilters();

    expect(invoicesService.getInvoices).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'FAC-0001', page: 1 }),
    );
  });

  it('sends the status filter to the server', () => {
    component.statusFilter.set('Paid');
    component.applyFilters();

    expect(invoicesService.getInvoices).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'Paid' }),
    );
  });

  it('returns to the first page when a filter changes', () => {
    invoicesService.getInvoices.mockReturnValue(of(page({ total: 200, pages: 4 })));
    component.loadInvoices();
    component.goToPage(1);
    expect(component.page()).toBe(2);

    component.searchTerm.set('algo');
    component.applyFilters();
    expect(component.page()).toBe(1);
  });

  it('does not page past the end', () => {
    invoicesService.getInvoices.mockReturnValue(of(page({ total: 10, pages: 1 })));
    component.loadInvoices();

    component.goToPage(1);
    expect(component.page()).toBe(1);
    component.goToPage(-1);
    expect(component.page()).toBe(1);
  });

  it('describes the range on screen', () => {
    invoicesService.getInvoices.mockReturnValue(
      of(page({ items: new Array(50).fill(null).map((_, i) => ({ id: String(i) })) as never, total: 120, pages: 3 })),
    );
    component.loadInvoices();
    expect(component.rangeLabel()).toBe('1–50 de 120');
  });

  it('surfaces a load failure instead of showing an empty list', () => {
    invoicesService.getInvoices.mockReturnValue(throwError(() => new Error('boom')));
    component.loadInvoices();

    expect(component.error()).toBeTruthy();
    expect(notifications.showError).toHaveBeenCalled();
    expect(component.isLoading()).toBe(false);
  });
});
