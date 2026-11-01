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
  //  El par desde/hasta invertido. `dateOrder` deja el error en el control TARDÍO además de en el
  //  grupo, precisamente para que el resumen pueda nombrar un campo en vez de decir que el
  //  formulario está mal en algún sitio.
  dateOrder: 'shell.problem_date_order',
};

function describe(name: string, label: string, errors: ValidationErrors): DraftProblem {
  //  Lo que el servidor dijo de este campo (`applyServerFieldErrors`), ya traducido.
  if (typeof errors['server'] === 'string') {
    return { message: errors['server'] as string, fieldId: name, params: { field: label } };
  }
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
      },
    };
  }
  //  Un validador propio que este mapa no conoce. Se nombra el campo en vez de callarse: el
  //  usuario no puede arreglar lo que no sabe que está mal.
  return { message: 'shell.problem_invalid', fieldId: name, params: { field: label } };
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

/**
 * Pone en cada control el error que el servidor devolvió para él —un SKU repetido— y lo marca
 * tocado, para que el campo se vea en rojo y el resumen lo nombre (QA R3-B01: el campo SKU no se
 * marcaba pese a que la respuesta traía `fieldErrors`). El error se va en cuanto el campo cambia.
 *
 * Devuelve cuántos controles marcó; los mensajes de campos que el formulario no tiene se ignoran
 * aquí y siguen en el aviso general.
 */
export function applyServerFieldErrors(group: FormGroup, fieldErrors: Record<string, string[]> | undefined): number {
  let marked = 0;
  for (const [name, messages] of Object.entries(fieldErrors ?? {})) {
    const control = group.get(name);
    if (!control || !messages?.length) continue;
    control.setErrors({ ...(control.errors ?? {}), server: messages[0] });
    control.markAsTouched();
    const subscription = control.valueChanges.subscribe(() => {
      subscription.unsubscribe();
      if (!control.errors?.['server']) return;
      const rest = { ...control.errors };
      delete rest['server'];
      control.setErrors(Object.keys(rest).length ? rest : null);
    });
    marked++;
  }
  return marked;
}
