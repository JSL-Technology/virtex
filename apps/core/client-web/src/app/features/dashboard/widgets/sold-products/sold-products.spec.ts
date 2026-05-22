import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SoldProducts } from './sold-products';

describe('SoldProducts', () => {
  let component: SoldProducts;
  let fixture: ComponentFixture<SoldProducts>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SoldProducts]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SoldProducts);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
