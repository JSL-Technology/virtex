import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { CustomerQuickCreateComponent } from './customer-quick-create.component';
import { CustomersService } from '../data/customers.service';
import { IdentityDocumentsService } from '../../../core/api/identity-documents.service';
import { LocaleStore } from '@virteex/shared/ui-i18n';

/**
 * The short form that lets an invoice be finished.
 *
 * Its contract with whatever opened it is one output with two possible answers — the customer, or
 * `null` — and neither of them may be silence: the field that opened this dialog is waiting on it.
 */
describe('CustomerQuickCreateComponent', () => {
  /**
   * El contenido vive en el contenedor del overlay del CDK, no bajo el host.
   *
   * Es lo mismo que ocurre en el navegador —y es justo lo que permite que un diálogo se salga de
   * cualquier contenedor con overflow oculto—, así que la prueba busca donde está de verdad.
   */
  const inDialog = (selector: string) => document.querySelector(selector);

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove());
  });

  let fixture: ComponentFixture<CustomerQuickCreateComponent>;
  let customers: { createCustomer: jest.Mock };

  beforeEach(async () => {
    customers = {
      createCustomer: jest.fn().mockReturnValue(
        of({ id: 'c-9', companyName: 'Bloques del Sur' }),
      ),
    };

    //  Sin `resetTestingModule`: el arnés global (`test-setup.ts`) ya instala las animaciones
    //  «noop» que el modal compartido necesita, y reiniciarlo las tiraría.
    await TestBed.configureTestingModule({
        imports: [CustomerQuickCreateComponent, TranslateModule.forRoot()],
        providers: [
          { provide: CustomersService, useValue: customers },
          {
            provide: IdentityDocumentsService,
            useValue: {
              list: () =>
                of([
                  {
                    code: 'RNC',
                    countryCode: 'DO',
                    labelKey: 'identity_document.do.rnc',
                    labelVerbatim: 'RNC',
                    example: '131000001',
                    pattern: '^\\d{9}$',
                    requirement: 'optional',
                    appliesTo: 'company',
                    isDefault: true,
                  },
                ]),
              label: (type: { labelVerbatim: string | null }) => type.labelVerbatim ?? '',
            },
          },
        ],
      })
      .compileComponents();

    //  El país nace con el del inquilino, no con una constante: sin contexto el campo queda vacío
    //  y el formulario —con razón— se niega a enviarse.
    TestBed.inject(LocaleStore).setTenantContext({ countryCode: 'DO' } as never);

    fixture = TestBed.createComponent(CustomerQuickCreateComponent);
    fixture.componentRef.setInput('initialName', 'Bloques del Sur');
    fixture.detectChanges();
  });

  it('arranca con lo que ya se había tecleado en el campo', () => {
    //  Quien escribió el nombre en el buscador y no lo encontró no debería escribirlo otra vez.
    const name = inDialog('#companyName') as HTMLInputElement;
    expect(name.value).toBe('Bloques del Sur');
  });

  it('no envía nada mientras falte el nombre', () => {
    const name = inDialog('#companyName') as HTMLInputElement;
    name.value = '';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (inDialog('.quick-create__save') as HTMLButtonElement).click();

    expect(customers.createCustomer).not.toHaveBeenCalled();
  });

  it('devuelve el cliente creado a quien abrió el diálogo', () => {
    let answer: unknown = 'nada';
    fixture.componentInstance.resolved.subscribe((customer) => (answer = customer));

    (inDialog('.quick-create__save') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(customers.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ companyName: 'Bloques del Sur' }),
    );
    expect(answer).toEqual({ id: 'c-9', companyName: 'Bloques del Sur' });
  });

  it('no manda una cadena vacía como documento fiscal', () => {
    //  El servidor validaría `''` COMO documento y respondería 422. Vacío es ausencia, no valor.
    (inDialog('.quick-create__save') as HTMLButtonElement).click();

    const payload = customers.createCustomer.mock.calls[0][0];
    expect(payload.taxId).toBeUndefined();
    expect(payload.identityDocumentTypeCode).toBeUndefined();
  });

  it('deja el motivo del rechazo dentro del diálogo, donde está el dato a corregir', fakeAsync(() => {
    customers.createCustomer.mockReturnValue(
      throwError(() => ({ error: { message: 'El RNC no es válido.' } })),
    );
    let answered = false;
    fixture.componentInstance.resolved.subscribe(() => (answered = true));

    (inDialog('.quick-create__save') as HTMLButtonElement).click();
    tick();
    fixture.detectChanges();

    expect(inDialog('.quick-create__error')?.textContent).toContain(
      'El RNC no es válido.',
    );
    //  Y sobre todo: el diálogo NO se cierra, porque cerrarlo devolvería al usuario al formulario
    //  sin el cliente y sin saber por qué.
    expect(answered).toBe(false);
    flush();
  }));

  it('responde con null cuando se cancela, en vez de callar', () => {
    let answer: unknown = 'nada';
    fixture.componentInstance.resolved.subscribe((customer) => (answer = customer));

    (inDialog('.quick-create__cancel') as HTMLButtonElement).click();

    expect(answer).toBeNull();
  });
});
