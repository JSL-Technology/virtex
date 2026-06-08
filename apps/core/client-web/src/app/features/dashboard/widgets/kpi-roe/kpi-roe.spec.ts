import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { KpiRoe } from './kpi-roe';

describe('KpiRoe', () => {
  let component: KpiRoe;
  let fixture: ComponentFixture<KpiRoe>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KpiRoe],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting()
      ]
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
