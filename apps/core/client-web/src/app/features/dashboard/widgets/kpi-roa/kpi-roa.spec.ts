import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KpiRoa } from './kpi-roa';

describe('KpiRoa', () => {
  let component: KpiRoa;
  let fixture: ComponentFixture<KpiRoa>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KpiRoa]
    })
    .compileComponents();

    fixture = TestBed.createComponent(KpiRoa);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
