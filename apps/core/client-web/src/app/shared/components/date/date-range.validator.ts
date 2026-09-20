import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { toCalendarDate } from './date-field.component';

/**
 * A group-level check that one date is not after another.
 *
 * For the reactive forms that hold their two dates as separate controls, where
 * `<vx-date-range>` — which owns both values — does not fit. Put it on the group:
 *
 *     this.fb.group({ issueDate: [''], dueDate: [''] }, { validators: dateOrder('issueDate', 'dueDate') })
 *
 * The error lands on the GROUP and also on the later control, so the shared draft gesture's error
 * summary (`draftProblems`) can name a field rather than saying the form is wrong somewhere.
 *
 * An incomplete range is not an invalid one: a form where only the start is filled in is being
 * filled in, and marking it red before the reader reaches the second field is the accessible
 * equivalent of a form that turns red on arrival.
 */
export function dateOrder(startControl: string, endControl: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const start = toCalendarDate(group.get(startControl)?.value);
    const end = group.get(endControl)?.value;
    const endDate = toCalendarDate(end);
    if (!start || !endDate) return null;

    const end_ = group.get(endControl);
    if (start <= endDate) {
      //  Se retira SOLO el error propio. Borrar el objeto entero se llevaría por delante el
      //  `required` o el `pattern` que otra regla haya puesto en el mismo control.
      if (end_?.hasError('dateOrder')) {
        const { dateOrder: _removed, ...rest } = end_.errors ?? {};
        end_.setErrors(Object.keys(rest).length > 0 ? rest : null);
      }
      return null;
    }

    end_?.setErrors({ ...(end_.errors ?? {}), dateOrder: { start, end: endDate } });
    return { dateOrder: { start, end: endDate } };
  };
}
