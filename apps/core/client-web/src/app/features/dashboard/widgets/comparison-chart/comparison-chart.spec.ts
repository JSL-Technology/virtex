import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ComparisonChart } from './comparison-chart';

describe('ComparisonChart', () => {
  let component: ComparisonChart;
  let fixture: ComponentFixture<ComparisonChart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComparisonChart]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ComparisonChart);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
