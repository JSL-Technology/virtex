import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BillingPage } from './billing.page';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { BillingService } from '../../../core/services/billing';

describe('BillingPage', () => {
  let component: BillingPage;
  let fixture: ComponentFixture<BillingPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BillingPage, HttpClientTestingModule],
      providers: [BillingService]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BillingPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * The page reads the subscription and the plans. Without a connection both fail, and it said so
   * twice, one error per group (R08); now one error speaks for the page and retries both.
   */
  describe('two reads, one state', () => {
    it('waits once while both are loading', () => {
      component.overviewState.set('loading');
      component.plansState.set('loading');
      expect(component.pageLoading()).toBe(true);
      component.plansState.set('loaded');
      expect(component.pageLoading()).toBe(false);
    });

    it('shows one error when both fail, and none of the groups', () => {
      component.overviewState.set('error');
      component.plansState.set('error');
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(component.allFailed()).toBe(true);
      expect(root.querySelectorAll('vx-error-state').length).toBe(1);
      expect(root.querySelector('vx-settings-group')).toBeNull();
    });

    it('keeps the error in its group when only one fails', () => {
      component.overviewState.set('error');
      component.plansState.set('loaded');
      fixture.detectChanges();
      expect(component.allFailed()).toBe(false);
      expect((fixture.nativeElement as HTMLElement).querySelectorAll('vx-error-state').length).toBe(1);
    });

    it('retries both reads from the single error', () => {
      const overview = jest.spyOn(component, 'refreshBillingData').mockImplementation(() => undefined);
      const plans = jest.spyOn(component, 'retryLoadPlans').mockImplementation(() => undefined);
      component.retryAll();
      expect(overview).toHaveBeenCalledTimes(1);
      expect(plans).toHaveBeenCalledTimes(1);
    });
  });
});
