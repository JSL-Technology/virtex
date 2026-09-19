import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { CustomersService } from '../data/customers.service';
import { Customer } from '../../../core/models/customer.model';
import {
  IdentityDocumentsService,
  IdentityDocumentTypeOption,
} from '../../../core/api/identity-documents.service';
import { CountryNamesService } from '../../../core/i18n/countries';
import { UiModalComponent } from '../../../shared/components/ui/modal';
import { VX_SELECT } from '../../../shared/components/select';
import { CountryOption } from '../../../core/i18n/countries';

/**
 * Register a customer without leaving the document being drafted.
 *
 * ## Why this is not the customer form
 *
 * `CustomerFormPage` is a page: it owns a draft gesture, it navigates, and it asks for the twenty
 * fields a customer record eventually holds. Opening it from an invoice means abandoning the
 * invoice. This asks for the four fields the server actually requires to accept a customer — and
 * says so, so nobody mistakes the short form for the whole record.
 *
 * Everything else about the customer is filled in later, from the customer's own screen. The one
 * thing this must not do is create a record the invoice cannot then be issued against, which is
 * why the fiscal identifier is here at all: it is optional to the customer table and mandatory to
 * several kinds of comprobante.
 */
@Component({
  selector: 'app-customer-quick-create',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, UiModalComponent, ...VX_SELECT, ...VX_FORM_A11Y],
  templateUrl: './customer-quick-create.component.html',
  styleUrls: ['./customer-quick-create.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerQuickCreateComponent implements AfterViewInit {
  private readonly fb = inject(FormBuilder);
  private readonly customers = inject(CustomersService);
  private readonly identityDocuments = inject(IdentityDocumentsService);
  private readonly countryNames = inject(CountryNamesService);
  private readonly locale = inject(LocaleStore);
  private readonly translate = inject(TranslateService);

  /** What the operator had already typed into the field that opened this. */
  readonly initialName = input('');

  /**
   * The created customer, or `null` when the operator backed out.
   *
   * Both are answers and the caller needs to tell them apart: one fills the field, the other leaves
   * it as it was. Neither may be silence — the field that opened this is waiting.
   */
  readonly resolved = output<Customer | null>();

  protected readonly countries = this.countryNames.options;

  //  Campos de función, no métodos: `vx-select` los recibe como entradas, y un método enlazado en
  //  la plantilla llegaría sin `this`. Declararlos así también los hace estables entre ciclos de
  //  detección, que es lo que evita que la lista se reconstruya en cada uno.
  protected readonly countryName = (country: CountryOption): string => country.name;
  protected readonly countryCode = (country: CountryOption): string => country.code;
  protected readonly documentTypes = signal<IdentityDocumentTypeOption[]>([]);
  protected readonly saving = signal(false);
  protected readonly failure = signal<string | null>(null);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  protected readonly form = this.fb.group({
    companyName: ['', Validators.required],
    // El país del tenant, no una constante: decide contra qué registro se valida el documento.
    country: [this.locale.tenantContext()?.countryCode ?? '', Validators.required],
    identityDocumentTypeCode: [''],
    taxId: [''],
    email: ['', [Validators.email]],
  });

  constructor() {
    this.identityDocuments
      .list({ appliesTo: 'both', usedFor: 'invoicing' })
      .pipe(catchError(() => of([] as IdentityDocumentTypeOption[])))
      .subscribe((types) => {
        this.documentTypes.set(types);
        const control = this.form.get('identityDocumentTypeCode');
        if (control && !control.value) {
          const preset = types.find((type) => type.isDefault) ?? types[0];
          if (preset) control.setValue(preset.code, { emitEvent: false });
        }
      });
  }

  ngAfterViewInit(): void {
    //  Se arranca con lo ya tecleado y el cursor dentro: quien escribió «Ferretería» en el campo y
    //  no la encontró no debería tener que escribirla otra vez aquí.
    this.form.patchValue({ companyName: this.initialName() });
    this.nameInput()?.nativeElement.focus();
  }

  protected documentLabel(type: IdentityDocumentTypeOption): string {
    return this.identityDocuments.label(type, (key) => this.translate.instant(key));
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    this.saving.set(true);
    this.failure.set(null);

    this.customers
      .createCustomer({
        companyName: value.companyName ?? '',
        country: value.country ?? '',
        //  Cadena vacía no es «sin documento» para el servidor, que la validaría como documento.
        taxId: value.taxId?.trim() || undefined,
        identityDocumentTypeCode: value.taxId?.trim()
          ? (value.identityDocumentTypeCode ?? undefined)
          : undefined,
        email: value.email?.trim() ?? '',
        phone: '',
      })
      .subscribe({
        next: (customer) => {
          this.saving.set(false);
          this.resolved.emit(customer);
        },
        error: (error: { error?: { message?: string } }) => {
          this.saving.set(false);
          //  El motivo se queda EN el diálogo. Un aviso que se desvanece obliga a reabrir el
          //  formulario para recordar qué había que corregir, y aquí el dato a corregir está
          //  delante.
          this.failure.set(
            error?.error?.message ?? this.translate.instant('contacts.customer_form.error_creating_customer'),
          );
        },
      });
  }

  protected cancel(): void {
    this.resolved.emit(null);
  }
}
