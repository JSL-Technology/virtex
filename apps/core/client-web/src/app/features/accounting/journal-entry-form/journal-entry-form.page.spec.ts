import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JournalEntryForm } from './journal-entry-form';

describe('JournalEntryForm', () => {
  let component: JournalEntryForm;
  let fixture: ComponentFixture<JournalEntryForm>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JournalEntryForm]
    })
    .compileComponents();

    fixture = TestBed.createComponent(JournalEntryForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
