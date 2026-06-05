import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DailyJournalPage } from './daily-journal.page';

describe('DailyJournalPage', () => {
  let component: DailyJournalPage;
  let fixture: ComponentFixture<DailyJournalPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DailyJournalPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DailyJournalPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
