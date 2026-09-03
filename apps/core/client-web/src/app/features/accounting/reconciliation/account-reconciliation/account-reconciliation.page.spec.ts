import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { AccountReconciliationPage } from './account-reconciliation.page';
import { BankAccount } from '../../../../core/api/treasury.service';
import {
  BankStatement,
  ReconciliationSummary,
  TransactionSuggestion,
} from '../../../../core/api/reconciliation.service';
import { environment } from '../../../../../environments/environment';

/**
 * The page it replaces rendered an empty table from a signal nothing ever wrote to, for every
 * tenant, always. What matters now is that the proof reaches the screen — a reader who is not
 * shown the difference cannot tell a reconciled account from an unreconciled one — and that the
 * button which closes a statement is only offered when the server would accept it.
 */
describe('AccountReconciliationPage', () => {
  let fixture: ComponentFixture<AccountReconciliationPage>;
  let component: AccountReconciliationPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const bankAccount: BankAccount = {
    id: 'b1',
    name: 'Popular corriente',
    bankName: 'Banco Popular',
    accountNumber: '7901234567',
    iban: null,
    swiftBic: null,
    accountType: 'CHECKING',
    currencyCode: 'DOP',
    glAccountId: 'gl1',
    openingBalance: 0,
    openingDate: null,
    isActive: true,
    notes: null,
  };

  const statement: BankStatement = {
    id: 's1',
    bankAccountId: 'b1',
    fileName: 'marzo.csv',
    startDate: '2026-03-01',
    endDate: '2026-03-31',
    startingBalance: 0,
    endingBalance: 10_000,
    status: 'IMPORTED',
    importError: null,
    reconciledAt: null,
    transactions: [
      {
        id: 't1',
        date: '2026-03-05',
        description: 'Deposito cliente Perez',
        reference: null,
        debit: 10_000,
        credit: 0,
        status: 'UNMATCHED',
        matchId: null,
        exclusionReason: null,
        sourceRow: 2,
      },
    ],
  };

  const balanced: ReconciliationSummary = {
    statementId: 's1',
    bankAccountId: 'b1',
    startDate: '2026-03-01',
    endDate: '2026-03-31',
    status: 'IMPORTED',
    statementEndingBalance: 10_000,
    bookBalance: 10_000,
    outstandingLedgerAmount: 0,
    outstandingLedgerCount: 0,
    unrecordedStatementAmount: 0,
    unrecordedStatementCount: 0,
    adjustedBankBalance: 10_000,
    adjustedBookBalance: 10_000,
    difference: 0,
    isReconciled: true,
    statementIsInternallyConsistent: true,
    statementInternalDifference: 0,
  };

  const suggestion: TransactionSuggestion = {
    bankTransactionId: 't1',
    date: '2026-03-05',
    description: 'Deposito cliente Perez',
    amount: 10_000,
    candidates: [
      {
        journalEntryLineId: 'l1',
        journalEntryId: 'e1',
        entryNumber: 'BANCOS-2026-000001',
        date: '2026-03-05',
        description: 'Cobro cliente',
        amount: 10_000,
        score: 100,
      },
    ],
    candidateGroups: [],
    suggestedRuleId: null,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AccountReconciliationPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountReconciliationPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  /** Bank accounts, then the statement list, then the three the workbench loads for a statement. */
  const openStatement = (summary: ReconciliationSummary = balanced) => {
    httpMock.expectOne((c) => c.url === `${API}/treasury/bank-accounts`).flush([bankAccount]);
    httpMock.expectOne((c) => c.url === `${API}/reconciliation/statements`).flush([statement]);
    httpMock.expectOne((c) => c.url === `${API}/reconciliation/statements/s1`).flush(statement);
    httpMock
      .expectOne((c) => c.url === `${API}/reconciliation/statements/s1/summary`)
      .flush(summary);
    httpMock
      .expectOne((c) => c.url === `${API}/reconciliation/statements/s1/suggestions`)
      .flush([suggestion]);
    fixture.detectChanges();
  };

  it('opens the tenant’s first statement and shows the proof', () => {
    fixture.detectChanges();
    openStatement();

    expect(component.summary()?.difference).toBe(0);
    const text = fixture.nativeElement.textContent as string;
    expect(fixture.nativeElement.querySelector('.proof')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.proof__difference--ok')).toBeTruthy();
    expect(text).toContain('Deposito cliente Perez');
    httpMock.verify();
  });

  it('offers to close only when the server would accept it', () => {
    fixture.detectChanges();
    // Balanced, but a movement is still unmatched: the server refuses, so the page does not offer.
    openStatement({ ...balanced, unrecordedStatementCount: 1, unrecordedStatementAmount: 10_000 });

    expect(component.canClose()).toBe(false);
    httpMock.verify();
  });

  it('will not confirm a match whose two sides disagree', () => {
    fixture.detectChanges();
    openStatement();

    component.openTransaction('t1');
    expect(component.canConfirm(suggestion)).toBe(false);

    component.toggleLine('l1');
    expect(component.selectedTotal(suggestion)).toBe(10_000);
    expect(component.canConfirm(suggestion)).toBe(true);
    httpMock.verify();
  });

  it("surfaces the server's reason when an operation is refused", () => {
    fixture.detectChanges();
    openStatement();

    component.openTransaction('t1');
    component.toggleLine('l1');
    component.confirmMatch(suggestion);

    httpMock
      .expectOne((c) => c.url === `${API}/reconciliation/matches`)
      .flush(
        { message: 'La conciliación no balancea.' },
        { status: 400, statusText: 'Bad Request' },
      );
    fixture.detectChanges();

    // The refusal IS the information — swallowing it into a generic failure hides why.
    expect(component.errorMessage()).toBe('La conciliación no balancea.');
    httpMock.verify();
  });
});
