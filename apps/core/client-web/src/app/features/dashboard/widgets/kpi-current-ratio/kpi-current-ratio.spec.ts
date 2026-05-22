import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KpiCurrentRatio } from './kpi-current-ratio';

describe('KpiCurrentRatio', () => {
  let component: KpiCurrentRatio;
  let fixture: ComponentFixture<KpiCurrentRatio>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KpiCurrentRatio]
    })
    .compileComponents();

    fixture = TestBed.createComponent(KpiCurrentRatio);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
