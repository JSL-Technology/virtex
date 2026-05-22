import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KpiRoe } from './kpi-roe';

describe('KpiRoe', () => {
  let component: KpiRoe;
  let fixture: ComponentFixture<KpiRoe>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KpiRoe]
    })
    .compileComponents();

    fixture = TestBed.createComponent(KpiRoe);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
