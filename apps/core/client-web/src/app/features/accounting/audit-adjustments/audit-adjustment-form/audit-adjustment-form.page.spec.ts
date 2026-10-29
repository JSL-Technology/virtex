import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { AuditAdjustmentFormPage } from './audit-adjustment-form.page';
import { AuditAdjustmentsService } from '../../../../core/api/audit-adjustments.service';
import { FiscalYearsService } from '../../../../core/api/fiscal-years.service';
import { AccountingService } from '../../../../core/api/accounting.service';
import { JournalsService } from '../../../../core/api/journals.service';
import { ChartOfAccountsApiService } from '../../data/chart-of-accounts.service';
import { NotificationService } from '../../../../core/services/notification';
import { DialogService } from '../../../../core/services/dialog.service';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';

/**
 * A correction to a closed year: balanced in cents, one side per line, dated the year's last day,
 * and never posted without saying first whether it will wait for approval.
 */
describe('AuditAdjustmentFormPage', () => {
  const year = { id: 'fy-2019', startDate: '2019-01-01', endDate: '2019-12-31', status: 'CLOSED' as const };
  let adjustments: Record<string, jest.Mock>;
  const confirm = jest.fn().mockResolvedValue(true);

  function create(closedYears = [year]) {
    localStorage.clear();
    confirm.mockClear();
    adjustments = {
      propose: jest.fn().mockReturnValue(of({ id: 'p1', status: 'PENDING_APPROVAL' })),
      approvalRoute: jest.fn().mockReturnValue(of({ requiresApproval: false, steps: 0 })),
    };
    TestBed.configureTestingModule({
      imports: [AuditAdjustmentFormPage, TranslateModule],
      providers: [
        provideRouter([]),
        { provide: AuditAdjustmentsService, useValue: adjustments },
        { provide: FiscalYearsService, useValue: { list: () => of(closedYears) } },
        { provide: AccountingService, useValue: { searchAccounts: () => of([]) } },
        { provide: ChartOfAccountsApiService, useValue: { getAccountById: (id: string) => of({ id, code: '1', name: 'X' }) } },
        { provide: JournalsService, useValue: { getJournals: () => of([{ id: 'j-gen', code: 'GENERAL', name: 'General', type: 'GENERAL' }]) } },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showHttpError: jest.fn() } },
        { provide: DialogService, useValue: { confirm, confirmClose: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (p: string) => p, slug: signal('acme') } },
      ],
    });
    const fixture = TestBed.createComponent(AuditAdjustmentFormPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const fill = (page: AuditAdjustmentFormPage, debit: number, credit: number) => {
    page.form.patchValue({ description: 'Gasto devengado' });
    page.lines.at(0).patchValue({ accountId: 'a1', description: 'Gasto', debit });
    page.lines.at(1).patchValue({ accountId: 'a2', description: 'Pasivo', credit });
  };

  it('picks the only closed year and the general journal, and dates the entry the year’s last day', () => {
    const page = create();
    expect(page.form.value.fiscalYearId).toBe('fy-2019');
    expect(page.form.value.journalId).toBe('j-gen');
    expect(page.chosenYear()?.endDate).toBe('2019-12-31');
  });

  it('totals in cents: 0.1 + 0.2 is 0.3, not 0.30000000000000004', () => {
    const page = create();
    page.lines.at(0).patchValue({ debit: 0.1 });
    page.addLine();
    page.lines.at(2).patchValue({ debit: 0.2 });
    expect(page.totals().debit).toBe(0.3);
  });

  it('clears the other side when one is typed, and refuses a line with both or neither', async () => {
    const page = create();
    page.lines.at(0).patchValue({ credit: 5 });
    page.lines.at(0).patchValue({ debit: 5 });
    page.onAmount(0, 'debit');
    expect(page.lines.at(0).value.credit).toBeNull();

    fill(page, 10, 10);
    page.lines.at(1).patchValue({ credit: null });
    await page.save();
    expect(page.problems()).toContainEqual(expect.objectContaining({ message: 'audit_adjustments.problem.line_one_side', params: { line: 2 } }));
    expect(adjustments['propose']).not.toHaveBeenCalled();
  });

  it('says it will post at once when there is no approval policy, and only then proposes', async () => {
    const page = create();
    fill(page, 1250.5, 1250.5);
    await page.save();
    expect(adjustments['approvalRoute']).toHaveBeenCalledWith(1250.5);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'audit_adjustments.confirm_without_approval', variant: 'warning' }));
    expect(adjustments['propose']).toHaveBeenCalledWith(expect.objectContaining({ date: '2019-12-31', fiscalYearId: 'fy-2019' }));
  });

  it('does not propose when the confirmation is declined', async () => {
    const page = create();
    fill(page, 10, 10);
    confirm.mockResolvedValueOnce(false);
    await page.save();
    expect(adjustments['propose']).not.toHaveBeenCalled();
  });

  it('explains the dead end when no year is closed yet', () => {
    const page = create([]);
    expect(page.yearsLoaded()).toBe(true);
    expect(page.years()).toEqual([]);
  });
});
