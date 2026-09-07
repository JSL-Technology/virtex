import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { draftProblems } from './draft-validation';

/**
 * El resumen sale del formulario, no de una lista escrita a mano.
 *
 * Diecinueve formularios deshabilitaban «Guardar» sin decir qué faltaba. Escribir el resumen en
 * cada uno habría sido escribir diecinueve listas que envejecen por separado: se añade un campo
 * obligatorio, nadie toca el resumen, y el formulario vuelve a no guardar sin decir por qué.
 */
describe('draftProblems', () => {
  it('nombra el campo que falta, con su rótulo', () => {
    const form = new FormGroup({
      name: new FormControl('', Validators.required),
      email: new FormControl('ok@example.com', Validators.email),
    });

    expect(draftProblems(form, { name: 'MASTERS.SUPPLIER_FORM.NOMBRE_PROVEEDOR' })).toEqual([
      {
        message: 'SHELL.PROBLEM_REQUIRED',
        fieldId: 'name',
        params: { field: 'MASTERS.SUPPLIER_FORM.NOMBRE_PROVEEDOR', min: undefined, max: undefined },
      },
    ]);
  });

  it('un formulario válido no tiene nada que revisar', () => {
    const form = new FormGroup({ name: new FormControl('Tornillo', Validators.required) });
    expect(draftProblems(form)).toEqual([]);
  });

  it('lleva el número que hace falta para arreglarlo', () => {
    const form = new FormGroup({ qty: new FormControl(2, Validators.min(5)) });
    const [problem] = draftProblems(form, { qty: 'QTY' });

    expect(problem.message).toBe('SHELL.PROBLEM_MIN');
    expect(problem.params?.['min']).toBe(5);
  });

  it('un campo sin rótulo declarado sale con su nombre, no con uno inventado', () => {
    // Feo a propósito: un nombre adivinado se ve bien y miente, y nadie lo corrige.
    const form = new FormGroup({ taxId: new FormControl('', Validators.required) });
    expect(draftProblems(form)[0].params?.['field']).toBe('taxId');
  });

  it('entra en los grupos anidados y nombra la ruta del control', () => {
    const form = new FormGroup({
      address: new FormGroup({ city: new FormControl('', Validators.required) }),
    });

    expect(draftProblems(form, { city: 'CITY' })[0].fieldId).toBe('address.city');
  });

  it('encuentra la línea concreta que falla en un array', () => {
    // Es el caso que más importa: una factura de veinte líneas con una sola mal, fuera de pantalla.
    const form = new FormGroup({
      lines: new FormArray([
        new FormGroup({ price: new FormControl(10, Validators.required) }),
        new FormGroup({ price: new FormControl('', Validators.required) }),
      ]),
    });

    const problems = draftProblems(form, { price: 'PRICE' });
    expect(problems.length).toBe(1);
    expect(problems[0].fieldId).toBe('lines.1.price');
  });

  it('un validador que no conoce se nombra igualmente', () => {
    // Callarse deja al usuario con un formulario que no guarda y ninguna pista.
    const form = new FormGroup({
      ncf: new FormControl('X', () => ({ ncfSequenceExhausted: true })),
    });

    expect(draftProblems(form, { ncf: 'NCF' })[0].message).toBe('SHELL.PROBLEM_INVALID');
  });
});
