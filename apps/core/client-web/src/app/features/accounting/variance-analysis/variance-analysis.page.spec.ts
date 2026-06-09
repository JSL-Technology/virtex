import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VarianceAnalysisPage } from './variance-analysis.page';

describe('VarianceAnalysis', () => {
  let component: VarianceAnalysisPage;
  let fixture: ComponentFixture<VarianceAnalysisPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VarianceAnalysisPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VarianceAnalysisPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
