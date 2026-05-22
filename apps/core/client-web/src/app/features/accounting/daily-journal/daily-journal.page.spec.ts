import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DailyJournal } from './daily-journal.page';

describe('DailyJournal', () => {
  let component: DailyJournal;
  let fixture: ComponentFixture<DailyJournal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DailyJournal]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DailyJournal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
