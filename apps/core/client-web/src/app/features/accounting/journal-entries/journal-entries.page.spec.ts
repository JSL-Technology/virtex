import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JournalEntriesPage } from './journal-entries.page';

describe('JournalEntriesPage', () => {
  let component: JournalEntriesPage;
  let fixture: ComponentFixture<JournalEntriesPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JournalEntriesPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(JournalEntriesPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
