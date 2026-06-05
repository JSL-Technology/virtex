import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BrandingPage } from './branding.page';

describe('BrandingPage', () => {
  let component: BrandingPage;
  let fixture: ComponentFixture<BrandingPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrandingPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BrandingPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
