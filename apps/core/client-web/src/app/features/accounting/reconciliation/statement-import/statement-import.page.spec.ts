import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { StatementImportPage } from './statement-import.page';
import { environment } from '../../../../../environments/environment';

/**
 * Reconciliation had no way to receive a statement at all. What matters here is that the format
 * travels with the file — the importer used to guess at both the date and the decimal separator,
 * and a statement that imports cleanly under the wrong guess is worse than one that refuses.
 */
describe('StatementImportPage', () => {
  let fixture: ComponentFixture<StatementImportPage>;
  let component: StatementImportPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const bankAccount = {
    id: 'b1',
    name: 'Popular corriente',
    bankName: 'Banco Popular',
    accountNumber: '7901234567',
    iban: null,
    swiftBic: null,
    accountType: 'CHECKING' as const,
    currencyCode: 'DOP',
    glAccountId: 'gl1',
    openingBalance: 0,
    openingDate: null,
    isActive: true,
    notes: null,
  };

  const csv = () =>
    new File(['Fecha,Concepto,Entrada,Salida\n05/03/2026,Deposito,10000.00,'], 'marzo.csv', {
      type: 'text/csv',
    });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatementImportPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(StatementImportPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne((c) => c.url === `${API}/treasury/bank-accounts`).flush([bankAccount]);
    fixture.detectChanges();
  });

  const fillMapping = () =>
    component.form.patchValue({
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      startingBalance: 0,
      endingBalance: 10_000,
      dateColumn: 'Fecha',
      descriptionColumn: 'Concepto',
      debitColumn: 'Entrada',
      creditColumn: 'Salida',
      dateFormat: 'dd/MM/yyyy',
      decimalSeparator: '.',
    });

  it('sends the file with the format it must be read under', () => {
    component.file.set(csv());
    fillMapping();
    component.submit();

    const request = httpMock.expectOne((c) => c.url === `${API}/reconciliation/statements`);
    const body = request.request.body as FormData;
    expect(body.get('dateFormat')).toBe('dd/MM/yyyy');
    expect(body.get('decimalSeparator')).toBe('.');
    expect(body.get('bankAccountId')).toBe('b1');
    expect((body.get('file') as File).name).toBe('marzo.csv');
    request.flush({ id: 's1', transactions: [] });
    httpMock.verify();
  });

  it('will not send without an amount mapping of some kind', () => {
    component.file.set(csv());
    fillMapping();
    component.form.patchValue({ debitColumn: '', creditColumn: '', amountColumn: '' });

    expect(component.hasAmountMapping()).toBe(false);
    component.submit();
    httpMock.expectNone((c) => c.url === `${API}/reconciliation/statements`);
    httpMock.verify();
  });

  it('will not send without a file', () => {
    fillMapping();
    component.submit();
    httpMock.expectNone((c) => c.url === `${API}/reconciliation/statements`);
    httpMock.verify();
  });

  it('shows the row the import stopped on', () => {
    component.file.set(csv());
    fillMapping();
    component.submit();

    httpMock
      .expectOne((c) => c.url === `${API}/reconciliation/statements`)
      .flush(
        { message: 'Formato inválido', detail: 'INVALID_DATE: {"row":4,"value":"ayer"}' },
        { status: 400, statusText: 'Bad Request' },
      );
    fixture.detectChanges();

    // Which row failed is the whole point; a generic message would send the user hunting.
    expect(component.importError()).toContain('"row":4');
    httpMock.verify();
  });
});
