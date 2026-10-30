import { AbstractControl, FormArray, FormGroup, ValidationErrors } from '@angular/forms';
import { DraftProblem } from './draft-shell.component';

/**
 * El resumen de errores de un formulario, derivado del propio formulario.
 *
 * ## Por qué se deriva y no se escribe
 *
 * Diecinueve formularios del producto deshabilitaban su botón de guardar cuando el formulario era
 * inválido, y ninguno decía qué faltaba. Un botón gris obliga a repasar el formulario buscando el
 * campo culpable —que en una factura con veinte líneas está fuera de la pantalla—, y quien no lo
 * encuentra concluye que la aplicación está rota.
 *
 * Escribir ese resumen a mano en cada formulario sería escribir diecinueve veces la misma lista, y
 * cada una envejecería con su formulario: se añade un campo obligatorio, nadie se acuerda del
 * resumen, y el formulario vuelve a no guardar sin decir por qué. Aquí se lee del `FormGroup`, así
 * que un validador nuevo aparece en el resumen sin que nadie tenga que acordarse de nada.
 *
 * ## Qué NO hace
 *
 * No inventa nombres de campo. Un control sin rótulo declarado sale con su propio nombre, que es
 * feo a propósito: es más honesto que un nombre bonito adivinado, y se ve en la primera prueba.
 */

/** Clave i18n del mensaje para cada tipo de error, en el orden en que se comprueban. */
const MESSAGE_BY_ERROR: Record<string, string> = {
  required: 'shell.problem_required',
  email: 'shell.problem_email',
  min: 'shell.problem_min',
  max: 'shell.problem_max',
  minlength: 'shell.problem_minlength',
  maxlength: 'shell.problem_maxlength',
  pattern: 'shell.field_not_expected_format',
  //  Un número que no se puede leer con la marca decimal en vigor (`VxNumberInputDirective`).
  localizedNumber: 'shell.problem_number',
  //  El par desde/hasta invertido. `dateOrder` deja el error en el control TARDÍO además de en el
  //  grupo, precisamente para que el resumen pueda nombrar un campo en vez de decir que el
  //  formulario está mal en algún sitio.
  dateOrder: 'shell.problem_date_order',
};

/**
 * The problem one control has, worded with the same keys the draft summary uses — for the message
 * under the field, so the field and the summary never say two different things.
 */
export function problemForControl(name: string, labelKey: string, control: AbstractControl): DraftProblem | null {
  return control.invalid ? describe(name, labelKey, control.errors ?? {}) : null;
}

function describe(name: string, label: string, errors: ValidationErrors): DraftProblem {
  for (const [error, message] of Object.entries(MESSAGE_BY_ERROR)) {
    if (!(error in errors)) continue;
    const detail = errors[error] as Record<string, unknown> | undefined;
    return {
      message,
      fieldId: name,
      params: {
        field: label,
        min: detail?.['min'] ?? detail?.['requiredLength'],
        max: detail?.['max'] ?? detail?.['requiredLength'],
        example: detail?.['example'],
      },
    };
  }
  //  Un validador propio que este mapa no conoce. Se nombra el campo en vez de callarse: el
  //  usuario no puede arreglar lo que no sabe que está mal.
  return { message: 'shell.problem_invalid', fieldId: name, params: { field: label } };
}

/**
 * La misma frase dicha de una línea de una tabla: «… (línea 3)». Literal, clave por clave, para que
 * el verificador del catálogo las vea: componerlas con `${message}_line` las dejaba huérfanas a sus
 * ojos, y la poda las borró.
 */
const LINE_MESSAGE: Record<string, string> = {
  'shell.problem_required': 'shell.problem_required_line',
  'shell.problem_email': 'shell.problem_email_line',
  'shell.problem_min': 'shell.problem_min_line',
  'shell.problem_max': 'shell.problem_max_line',
  'shell.problem_minlength': 'shell.problem_minlength_line',
  'shell.problem_maxlength': 'shell.problem_maxlength_line',
  'shell.field_not_expected_format': 'shell.field_not_expected_format_line',
  'shell.problem_number': 'shell.problem_number_line',
  'shell.problem_date_order': 'shell.problem_date_order_line',
  'shell.problem_invalid': 'shell.problem_invalid_line',
};

/** La clave «de línea» de un mensaje, o el mismo mensaje si no la tiene. */
export function lineMessage(message: string): string {
  return LINE_MESSAGE[message] ?? message;
}

/**
 * Un problema por control inválido, con la clave i18n de su rótulo.
 *
 * `labels` mapea el nombre del control a la clave de su etiqueta — la misma que ya usa el `<label>`
 * de la plantilla, así que no hay un segundo vocabulario que mantener. El armazón traduce; aquí
 * solo se recogen claves.
 */
export function draftProblems(
  group: FormGroup,
  labels: Record<string, string> = {},
  prefix = '',
): DraftProblem[] {
  const problems: DraftProblem[] = [];

  for (const [name, control] of Object.entries(group.controls)) {
    const path = prefix ? `${prefix}.${name}` : name;

    if (control instanceof FormGroup) {
      problems.push(...draftProblems(control, labels, path));
      continue;
    }
    if (control instanceof FormArray) {
      control.controls.forEach((child, index) => {
        if (child instanceof FormGroup) {
          problems.push(...draftProblems(child, labels, `${path}.${index}`));
        } else if (child.invalid) {
          problems.push(describe(`${path}.${index}`, labels[name] ?? name, child.errors ?? {}));
        }
      });
      continue;
    }

    const plain = control as AbstractControl;
    if (plain.invalid) problems.push(describe(path, labels[name] ?? name, plain.errors ?? {}));
  }

  return problems;
}
