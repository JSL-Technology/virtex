import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImpactAnalysisModal } from './impact-analysis-modal';

describe('ImpactAnalysisModal', () => {
  let component: ImpactAnalysisModal;
  let fixture: ComponentFixture<ImpactAnalysisModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImpactAnalysisModal]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ImpactAnalysisModal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
