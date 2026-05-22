import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Branding } from './branding.page';

describe('Branding', () => {
  let component: Branding;
  let fixture: ComponentFixture<Branding>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Branding]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Branding);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
