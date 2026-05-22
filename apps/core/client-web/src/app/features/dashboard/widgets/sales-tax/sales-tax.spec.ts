import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SalesTax } from './sales-tax';

describe('SalesTax', () => {
  let component: SalesTax;
  let fixture: ComponentFixture<SalesTax>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalesTax]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SalesTax);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
