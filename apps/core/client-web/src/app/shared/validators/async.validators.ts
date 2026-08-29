import { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import { Observable, of } from 'rxjs';

/**
 * Asynchronous form validators.
 *
 * The two that lived here — `createEmailValidator` and `createTaxIdValidator` — asked the server
 * whether an email address or a tax id was already registered, so the signup form could show
 * "already in use" as the user typed. Both endpoints were unauthenticated, and both were
 * therefore enumeration oracles: one told anyone whether a given person has an account here, the
 * other told anyone whether a given company is a customer. That is not a trade-off worth making
 * for inline feedback, and it defeated the anti-enumeration work the login and registration paths
 * do deliberately.
 *
 * Uniqueness is checked when the form is submitted, by which point the caller has already proven
 * control of the address through the emailed verification code.
 */
export class AsyncValidators {
  /**
   * Placeholder that always passes.
   *
   * Kept so the shape of this module stays obvious to the next person who reaches for a "check
   * with the server as the user types" validator: whatever it asks about must not be something an
   * unauthenticated caller should be able to enumerate.
   */
  static none(): AsyncValidatorFn {
    return (_control: AbstractControl): Observable<ValidationErrors | null> => of(null);
  }
}
