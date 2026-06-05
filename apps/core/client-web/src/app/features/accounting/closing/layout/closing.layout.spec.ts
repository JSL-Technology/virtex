import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClosingLayout } from './closing.layout';

describe('ClosingLayout', () => {
  let component: ClosingLayout;
  let fixture: ComponentFixture<ClosingLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClosingLayout]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ClosingLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
