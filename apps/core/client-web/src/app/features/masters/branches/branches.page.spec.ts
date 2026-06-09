import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BranchesPage } from './branches.page';

describe('Branches', () => {
  let component: BranchesPage;
  let fixture: ComponentFixture<BranchesPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BranchesPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(BranchesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
