import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WarehousesPage } from './warehouses.page';

describe('Warehouses', () => {
  let component: WarehousesPage;
  let fixture: ComponentFixture<WarehousesPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WarehousesPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(WarehousesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
