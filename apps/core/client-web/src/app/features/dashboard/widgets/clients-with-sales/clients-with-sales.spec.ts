import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClientsWithSales } from './clients-with-sales';

describe('ClientsWithSales', () => {
  let component: ClientsWithSales;
  let fixture: ComponentFixture<ClientsWithSales>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClientsWithSales]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClientsWithSales);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
