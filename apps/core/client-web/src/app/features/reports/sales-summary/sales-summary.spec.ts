import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SalesSummary } from './sales-summary';

describe('SalesSummary', () => {
  let component: SalesSummary;
  let fixture: ComponentFixture<SalesSummary>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalesSummary]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SalesSummary);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
