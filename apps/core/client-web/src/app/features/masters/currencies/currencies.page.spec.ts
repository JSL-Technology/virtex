import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CurrenciesPage } from './currencies.page';

describe('Currencies', () => {
  let component: CurrenciesPage;
  let fixture: ComponentFixture<CurrenciesPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CurrenciesPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CurrenciesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
