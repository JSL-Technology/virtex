import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CompanyProfilePage } from './company-profile.page';

describe('CompanyProfile', () => {
  let component: CompanyProfilePage;
  let fixture: ComponentFixture<CompanyProfilePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompanyProfilePage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CompanyProfilePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
