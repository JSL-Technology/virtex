import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UnitsOfMeasurePage } from './units-of-measure.page';

describe('UnitsOfMeasurePage', () => {
  let component: UnitsOfMeasurePage;
  let fixture: ComponentFixture<UnitsOfMeasurePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnitsOfMeasurePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UnitsOfMeasurePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
