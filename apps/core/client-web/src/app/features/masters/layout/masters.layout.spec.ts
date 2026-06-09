import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MastersLayout } from './masters.layout';

describe('Layout', () => {
  let component: MastersLayout;
  let fixture: ComponentFixture<MastersLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MastersLayout]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MastersLayout);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
