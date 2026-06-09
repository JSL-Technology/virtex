import { provideRouter } from "@angular/router";
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ClosingLayout } from './closing.layout';

describe('Layout', () => {
  let component: ClosingLayout;
  let fixture: ComponentFixture<ClosingLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([])], imports: [ClosingLayout]
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
