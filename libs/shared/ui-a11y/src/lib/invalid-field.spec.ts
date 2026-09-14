import { Component } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VX_FORM_A11Y } from './invalid-field.directive';

/**
 * A screen reader has to be able to find the field that is wrong.
 *
 * The forms report validation well enough to look at — a summary at the top, a message under each
 * field, a link from one to the other — and all of it is visual. Of 323 form controls in the
 * client, exactly one carried `aria-invalid`. A blind user could hear that saving had failed and
 * then read the same neutral list of fields as before, with nothing marking any of them.
 */
@Component({
  standalone: true,
  imports: [ReactiveFormsModule, ...VX_FORM_A11Y],
  template: `
    <form [formGroup]="form">
      <input id="email" formControlName="email" />
      <input id="note" formControlName="note" />
    </form>
  `,
})
class HostComponent {
  private readonly fb = new FormBuilder();
  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    note: [''],
  });
}

describe('Invalid fields are announced as invalid', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const attr = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector(`#${id}`)?.getAttribute('aria-invalid');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('marks nothing on a form nobody has touched', () => {
    // `email` is required and therefore invalid from the moment the form is built. Saying so now
    // would flag every empty field on a freshly opened form before the user had typed anything.
    expect(host.form.get('email')?.invalid).toBe(true);
    expect(attr('email')).toBeNull();
    expect(attr('note')).toBeNull();
  });

  it('marks the field once the user has left it', () => {
    host.form.get('email')?.markAsTouched();
    fixture.detectChanges();

    expect(attr('email')).toBe('true');
    expect(attr('note')).toBeNull();
  });

  it('marks every offending field when a refused submit touches them all', () => {
    // What the shared draft gesture does when validation refuses a save. It emits no status
    // change, which is why the directive listens to `events` rather than `statusChanges`.
    host.form.markAllAsTouched();
    fixture.detectChanges();

    expect(attr('email')).toBe('true');
    expect(attr('note')).toBeNull();
  });

  it('stops marking the field as soon as it is corrected', () => {
    host.form.markAllAsTouched();
    fixture.detectChanges();
    expect(attr('email')).toBe('true');

    host.form.get('email')?.setValue('ana@acme.do');
    fixture.detectChanges();

    // Removed, not set to "false": absent is the default, and an explicit false on every input is
    // noise in the accessibility tree.
    expect(attr('email')).toBeNull();
  });

  it('marks it again when a corrected field goes bad once more', () => {
    host.form.markAllAsTouched();
    host.form.get('email')?.setValue('ana@acme.do');
    fixture.detectChanges();
    expect(attr('email')).toBeNull();

    host.form.get('email')?.setValue('not-an-email');
    fixture.detectChanges();
    expect(attr('email')).toBe('true');
  });
});
