import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PurchasingLayout } from './purchasing.layout';

describe('Layout', () => {
  let component: PurchasingLayout;
  let fixture: ComponentFixture<PurchasingLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PurchasingLayout]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PurchasingLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
