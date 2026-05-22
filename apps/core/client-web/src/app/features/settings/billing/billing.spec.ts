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
});
