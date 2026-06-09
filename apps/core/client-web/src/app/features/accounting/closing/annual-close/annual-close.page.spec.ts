import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnnualClosePage } from './annual-close.page';

describe('AnnualClose', () => {
  let component: AnnualClosePage;
  let fixture: ComponentFixture<AnnualClosePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnnualClosePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AnnualClosePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
