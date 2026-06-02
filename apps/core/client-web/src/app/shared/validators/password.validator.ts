// H7 FIX: aligned with backend PASSWORD_POLICY_REGEX (min 12, max 72,
// uppercase + lowercase + (digit OR non-word char)).
import { ValidatorFn, AbstractControl } from '@angular/forms';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;

export function strongPasswordValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
        const value: string = control.value ?? '';
        if (!value) return null;

        const errors: Record<string, unknown> = {};

        if (value.length < PASSWORD_MIN_LENGTH) {
            errors['minLength'] = { requiredLength: PASSWORD_MIN_LENGTH, actualLength: value.length };
        }
        if (value.length > PASSWORD_MAX_LENGTH) {
            errors['maxLength'] = { maxLength: PASSWORD_MAX_LENGTH, actualLength: value.length };
        }
        if (!/[A-Z]/.test(value)) errors['missingUppercase'] = true;
        if (!/[a-z]/.test(value)) errors['missingLowercase'] = true;
        if (!/[0-9]/.test(value) && !/\W/.test(value)) errors['missingNumberOrSpecial'] = true;

        return Object.keys(errors).length > 0 ? { strongPassword: errors } : null;
    };
}