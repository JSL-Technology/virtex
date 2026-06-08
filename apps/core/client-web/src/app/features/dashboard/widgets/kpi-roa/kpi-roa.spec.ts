import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { KpiRoa } from './kpi-roa';

describe('KpiRoa', () => {
  let component: KpiRoa;
  let fixture: ComponentFixture<KpiRoa>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KpiRoa],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting()
      ]
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
