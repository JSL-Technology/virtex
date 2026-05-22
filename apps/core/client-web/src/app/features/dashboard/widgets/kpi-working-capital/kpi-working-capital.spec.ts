import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KpiWorkingCapital } from './kpi-working-capital';

describe('KpiWorkingCapital', () => {
  let component: KpiWorkingCapital;
  let fixture: ComponentFixture<KpiWorkingCapital>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KpiWorkingCapital]
    })
    .compileComponents();

    fixture = TestBed.createComponent(KpiWorkingCapital);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
