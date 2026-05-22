import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RecentActivity } from './recent-activity';

describe('RecentActivity', () => {
  let component: RecentActivity;
  let fixture: ComponentFixture<RecentActivity>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecentActivity]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RecentActivity);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
