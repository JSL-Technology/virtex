// ../app/shared/validators/password.validator.ts

import { ValidatorFn, AbstractControl } from '@angular/forms';

export function strongPasswordValidator(): ValidatorFn {
    return (control: AbstractControl): { [key: string]: any } | null => {
        const value = control.value;
        if (!value) return null;

        const errors: any = {};

        // Longitud mínima
        if (value.length < 8) {
            errors.minLength = { requiredLength: 8, actualLength: value.length };
        }

        // Caracteres requeridos
        if (!/[A-Z]/.test(value)) errors.missingUppercase = true;
        if (!/[a-z]/.test(value)) errors.missingLowercase = true;
        if (!/[0-9]/.test(value)) errors.missingNumber = true;
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) errors.missingSpecial = true;

        return Object.keys(errors).length > 0 ? { strongPassword: errors } : null;
    };
}