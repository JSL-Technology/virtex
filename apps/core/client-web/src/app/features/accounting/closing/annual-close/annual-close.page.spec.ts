import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnnualClose } from './annual-close.page';

describe('AnnualClose', () => {
  let component: AnnualClose;
  let fixture: ComponentFixture<AnnualClose>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnnualClose]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AnnualClose);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
