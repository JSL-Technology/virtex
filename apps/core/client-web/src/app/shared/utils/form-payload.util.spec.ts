import { formPayload } from './form-payload.util';

describe('formPayload', () => {
  it('omite los campos en blanco al crear (QA C-04)', () => {
    expect(formPayload({ name: ' Acme ', email: '', identityDocumentTypeCode: '   ' }, 'create')).toEqual({
      name: 'Acme',
    });
  });

  it('envía null en blanco al actualizar, para poder borrar un campo', () => {
    expect(formPayload({ name: 'Acme', email: '' }, 'update')).toEqual({ name: 'Acme', email: null });
  });

  it('respeta los valores no textuales y los campos marcados para conservar', () => {
    expect(formPayload({ days: 0, active: false, note: '' }, 'create', ['note'])).toEqual({
      days: 0,
      active: false,
      note: '',
    });
  });
});
