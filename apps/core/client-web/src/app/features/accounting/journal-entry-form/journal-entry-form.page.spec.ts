import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JournalEntryFormPage } from './journal-entry-form.page';

describe('JournalEntryFormPage', () => {
  let component: JournalEntryFormPage;
  let fixture: ComponentFixture<JournalEntryFormPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JournalEntryFormPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(JournalEntryFormPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
