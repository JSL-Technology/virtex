import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Currencies } from './currencies.page';

describe('Currencies', () => {
  let component: Currencies;
  let fixture: ComponentFixture<Currencies>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Currencies]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Currencies);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
