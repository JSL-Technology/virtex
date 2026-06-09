import { provideRouter } from "@angular/router";
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ApprovalsPage } from './approvals.page';

describe('Approvals', () => {
  let component: ApprovalsPage;
  let fixture: ComponentFixture<ApprovalsPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([])], imports: [ApprovalsPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ApprovalsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
