import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { VX_DATE, dateOrder, toCalendarDate } from './index';

@Component({
  standalone: true,
  imports: [TranslateModule, ...VX_DATE],
  template: `<vx-date-range [(from)]="from" [(to)]="to" />`,
})
class RangeHost {
  readonly from = signal<string | null>(null);
  readonly to = signal<string | null>(null);
}

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, ...VX_DATE],
  template: `
    <form [formGroup]="form">
      <vx-date-field inputId="issueDate" formControlName="issueDate" [required]="true" />
    </form>
  `,
})
class FormHost {
  readonly form: FormGroup = inject(FormBuilder).group({
    issueDate: ['', Validators.required],
    dueDate: [''],
  });
}

describe('campos de fecha', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('vx-date-range', () => {
    function build() {
      TestBed.configureTestingModule({ imports: [RangeHost, TranslateModule.forRoot()] });
      const fixture = TestBed.createComponent(RangeHost);
      fixture.detectChanges();
      return fixture;
    }

    function inputs(fixture: ReturnType<typeof build>): HTMLInputElement[] {
      return Array.from(fixture.nativeElement.querySelectorAll('input[type="date"]'));
    }

    function type(fixture: ReturnType<typeof build>, index: number, value: string): void {
      const input = inputs(fixture)[index];
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('acota cada extremo con el otro', () => {
      //  Las quince páginas que emparejan dos fechas tenían CERO `min` y CERO `max` entre todas.
      const fixture = build();
      type(fixture, 0, '2026-03-01');
      expect(inputs(fixture)[1].getAttribute('min')).toBe('2026-03-01');

      type(fixture, 1, '2026-03-31');
      expect(inputs(fixture)[0].getAttribute('max')).toBe('2026-03-31');
    });

    it('dice que el rango está invertido en vez de devolver un informe vacío', () => {
      const fixture = build();
      type(fixture, 0, '2026-06-30');
      type(fixture, 1, '2026-01-01');

      const message = fixture.nativeElement.querySelector('.vx-date-range__message') as HTMLElement;
      expect(message).not.toBeNull();
      expect(message.getAttribute('role')).toBe('alert');
      //  Y los dos campos apuntan al mensaje, porque habla del par y no de uno de los dos.
      expect(inputs(fixture)[0].getAttribute('aria-describedby')).toBe(message.id);
      expect(inputs(fixture)[1].getAttribute('aria-describedby')).toBe(message.id);
    });

    it('un rango a medio llenar no está mal, está sin terminar', () => {
      const fixture = build();
      type(fixture, 0, '2026-06-30');
      expect(fixture.nativeElement.querySelector('.vx-date-range__message')).toBeNull();
    });

    it('vaciar un extremo lo deja en nulo, no en cadena vacía', () => {
      const fixture = build();
      type(fixture, 0, '2026-06-30');
      type(fixture, 0, '');
      expect(fixture.componentInstance.from()).toBeNull();
    });
  });

  describe('vx-date-field dentro de un formulario', () => {
    function build() {
      TestBed.configureTestingModule({ imports: [FormHost, TranslateModule.forRoot()] });
      const fixture = TestBed.createComponent(FormHost);
      fixture.detectChanges();
      return fixture;
    }

    it('funciona como control nativo', () => {
      const fixture = build();
      const input = fixture.nativeElement.querySelector('input[type="date"]') as HTMLInputElement;

      fixture.componentInstance.form.patchValue({ issueDate: '2026-02-14' });
      fixture.detectChanges();
      expect(input.value).toBe('2026-02-14');

      input.value = '2026-02-20';
      input.dispatchEvent(new Event('input'));
      expect(fixture.componentInstance.form.get('issueDate')?.value).toBe('2026-02-20');
    });

    it('marca el campo inválido sobre el input, no sobre el envoltorio', () => {
      const fixture = build();
      const input = fixture.nativeElement.querySelector('input[type="date"]') as HTMLInputElement;
      expect(input.getAttribute('aria-invalid')).toBeNull();

      fixture.componentInstance.form.get('issueDate')?.markAsTouched();
      fixture.detectChanges();
      expect(input.getAttribute('aria-invalid')).toBe('true');
    });

    it('se deshabilita con el control', () => {
      const fixture = build();
      fixture.componentInstance.form.disable();
      fixture.detectChanges();
      expect(
        (fixture.nativeElement.querySelector('input[type="date"]') as HTMLInputElement).disabled,
      ).toBe(true);
    });
  });

  describe('normalización', () => {
    it('reduce cualquier forma de fecha al día suelto', () => {
      //  Una fecha contable no tiene hora ni zona. Construirla en hora local es lo que convierte
      //  el 31 de enero en el 30 para todo el que esté al oeste de Greenwich.
      expect(toCalendarDate('2026-01-31')).toBe('2026-01-31');
      expect(toCalendarDate('2026-01-31T04:00:00.000Z')).toBe('2026-01-31');
      expect(toCalendarDate(new Date(Date.UTC(2026, 0, 31)))).toBe('2026-01-31');
      expect(toCalendarDate('')).toBeNull();
      expect(toCalendarDate(null)).toBeNull();
      expect(toCalendarDate('mañana')).toBeNull();
    });
  });

  describe('dateOrder', () => {
    function group(): FormGroup {
      const fb = new FormBuilder();
      return fb.group(
        { startDate: [''], endDate: [''] },
        { validators: dateOrder('startDate', 'endDate') },
      );
    }

    it('rechaza el par invertido y nombra el control tardío', () => {
      const form = group();
      form.patchValue({ startDate: '2026-06-30', endDate: '2026-01-01' });

      expect(form.hasError('dateOrder')).toBe(true);
      //  En el control además del grupo, para que el resumen del armazón de borrador pueda
      //  nombrar un campo en vez de decir que el formulario está mal en algún sitio.
      expect(form.get('endDate')?.hasError('dateOrder')).toBe(true);
    });

    it('acepta el par correcto y el mismo día', () => {
      const form = group();
      form.patchValue({ startDate: '2026-01-01', endDate: '2026-06-30' });
      expect(form.hasError('dateOrder')).toBe(false);

      form.patchValue({ endDate: '2026-01-01' });
      expect(form.hasError('dateOrder')).toBe(false);
    });

    it('no se pronuncia sobre un rango a medio llenar', () => {
      const form = group();
      form.patchValue({ startDate: '2026-06-30' });
      expect(form.hasError('dateOrder')).toBe(false);
    });

    it('al corregirse no se lleva por delante otros errores del mismo control', () => {
      const fb = new FormBuilder();
      const form = fb.group(
        { startDate: [''], endDate: ['', Validators.required] },
        { validators: dateOrder('startDate', 'endDate') },
      );
      form.patchValue({ startDate: '2026-06-30', endDate: '2026-01-01' });
      expect(form.get('endDate')?.hasError('dateOrder')).toBe(true);

      form.patchValue({ endDate: '2026-12-31' });
      expect(form.get('endDate')?.hasError('dateOrder')).toBe(false);

      form.patchValue({ endDate: '' });
      expect(form.get('endDate')?.hasError('required')).toBe(true);
    });
  });
});
