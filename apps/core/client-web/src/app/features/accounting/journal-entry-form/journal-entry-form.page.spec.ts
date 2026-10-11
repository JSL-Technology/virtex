import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JournalEntryFormPage } from './journal-entry-form.page';

describe('JournalEntryForm', () => {
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

  it('is editable until a reason to lock it is known', () => {
    expect(component.readOnly()).toBe(false);
    expect(component.entryForm.enabled).toBe(true);
  });

  // QA M5: an entry a document generated opened as an editable form whose «Save» did nothing.
  it('shows a locked entry for reading only, with nothing to type or save', () => {
    component.editBlockedKey.set('accounting.journal_entry_form.generated_from_document');
    (component as unknown as { lockForm(): void }).lockForm();
    fixture.detectChanges();

    expect(component.readOnly()).toBe(true);
    expect(component.entryForm.disabled).toBe(true);
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('button[type="submit"]')).toBeNull();
    expect(host.querySelector('#modificationReason')).toBeNull();
    expect(host.querySelector('.entry-locked')).not.toBeNull();
  });
});
