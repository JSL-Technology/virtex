import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

export function IsRNC(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isRNC',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, args: ValidationArguments) {
          if (typeof value !== 'string') return false;

          const rnc = value.replace(/[^\d]/g, '');

          if (rnc.length !== 9 && rnc.length !== 11) {
             return false;
          }

          return validateRNC(rnc);
        },
        defaultMessage(args: ValidationArguments) {
             return 'El RNC debe ser válido (9 u 11 dígitos y cumplir algoritmo de validación)';
        }
      },
    });
  };
}

function validateRNC(rnc: string): boolean {
    const weight = [7, 9, 8, 6, 5, 4, 3, 2];

    if (rnc.length === 9) {
        let sum = 0;
        for (let i = 0; i < 8; i++) {
            sum += parseInt(rnc.charAt(i)) * weight[i];
        }
        // Modulo 11 Algorithm (DGII - Dominican Republic)
        // 1. Sum = Sum(digit * weight)
        // 2. Remainder = Sum % 11
        // 3. Digit:
        //    If Remainder = 0 -> Digit = 2
        //    If Remainder = 1 -> Digit = 1
        //    Else -> Digit = 11 - Remainder
        let remainder = sum % 11;
        let digit = 0;

        if (remainder === 0) {
            digit = 2;
        } else if (remainder === 1) {
            digit = 1;
        } else {
            digit = 11 - remainder;
        }

        return digit === parseInt(rnc.charAt(8));
    } else if (rnc.length === 11) {
        return validateCedula(rnc);
    }
    return false;
}

function validateCedula(ced: string): boolean {
    let c = ced.replace(/-/g,'');
    if(c.length !== 11) return false;
    let cedula = c.substring(0, 10);
    let verificador = c.substring(10, 11);
    let suma = 0;

    for (let i = 0; i < cedula.length; i++) {
        let mod = "";
        if((i % 2) === 0){mod = "1"} else {mod = "2"}
        let res = parseInt(cedula.substring(i, i+1)) * parseInt(mod);
        if (res > 9) {
            res = parseInt(res.toString().substring(0, 1)) + parseInt(res.toString().substring(1, 2));
        }
        suma += res;
    }

    let el_numero = (10 - (suma % 10)) % 10;
    return el_numero === parseInt(verificador);
}
