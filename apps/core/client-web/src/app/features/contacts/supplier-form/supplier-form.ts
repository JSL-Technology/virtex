import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SuppliersService, CreateSupplierDto, UpdateSupplierDto } from '../../../core/api/suppliers.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { CountryNamesService } from '../../../core/i18n/countries';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import {
  IdentityDocumentsService,
  IdentityDocumentTypeOption,
} from '../../../core/api/identity-documents.service';

@Component({
  selector: 'app-supplier-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent, ...VX_FORM_A11Y],
  templateUrl: './supplier-form.html',
  styleUrls: ['./supplier-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupplierForm implements OnInit {
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private suppliersService = inject(SuppliersService);
  private notificationService = inject(NotificationService);
  private readonly countryNames = inject(CountryNamesService);
  private readonly identityDocuments = inject(IdentityDocumentsService);
  private readonly locale = inject(LocaleStore);
  private readonly translate = inject(TranslateService);

  /**
   * The identifiers this tenant's country issues, from the catalogue.
   *
   * Purchasing had the same gap sales did: one free-text field labelled after two documents at
   * once, with nothing recording which had been entered — while the 606 filing that reports
   * purchases has to state it.
   */
  protected readonly documentTypes = signal<IdentityDocumentTypeOption[]>([]);

  /** Every country, in the reader's language. See `CountryNamesService`. */
  protected readonly countries = this.countryNames.options;


  /**
   * The fiscal classifications a supplier can hold, in the order they are met.
   *
   * The same list the customer form offers, because it is the same list every withholding regime
   * in the product is written against. A supplier record could not hold one at all until now,
   * which is why the withholding on a purchase arrived as a free number: nothing on the supplier
   * could establish the rate.
   */
  protected readonly taxpayerTypes = [
    { value: 'INDIVIDUAL', labelKey: 'contacts.customer_form.individual' },
    { value: 'COMPANY', labelKey: 'contacts.customer_form.company' },
    {
      value: 'WITHHOLDING_AGENT',
      labelKey: 'contacts.customer_form.designated_withholding_agent',
    },
    { value: 'GOVERNMENT', labelKey: 'contacts.customer_form.government_body' },
    { value: 'FOREIGN', labelKey: 'contacts.customer_form.customer_abroad' },
  ] as const;

  /** Qué falta antes de guardar. Se llena al pulsar, no mientras se teclea el primer campo. */
  readonly problems = signal<DraftProblem[]>([]);

  supplierForm!: FormGroup;
  isEditMode = signal(false);
  isLoading = signal(true);
  private supplierId: string | null = null;

  /**
   * Adopt the catalogue, preselecting the default only when nothing is chosen yet — never over an
   * existing supplier's recorded type, which would be a data change disguised as a render.
   */
  private applyDocumentTypes(types: IdentityDocumentTypeOption[]): void {
    this.documentTypes.set(types);
    const control = this.supplierForm?.get('identityDocumentTypeCode');
    if (control && !control.value) {
      const preset = types.find((type) => type.isDefault) ?? types[0];
      if (preset) control.setValue(preset.code, { emitEvent: false });
    }
    this.syncTaxIdValidators();
  }

  /**
   * Apply the selected document's shape to the tax-id field for immediate feedback (B-01).
   *
   * The catalogue publishes `pattern` so a mistyped NIT or RUT is caught while typing; it was
   * unused. The check digit remains the server's, and the field stays optional.
   */
  private syncTaxIdValidators(): void {
    const taxId = this.supplierForm?.get('taxId');
    if (!taxId) return;
    const selected = this.supplierForm?.get('identityDocumentTypeCode')?.value as string | undefined;
    const type = this.documentTypes().find((option) => option.code === selected);
    taxId.setValidators(type ? [Validators.pattern(new RegExp(type.pattern))] : []);
    taxId.updateValueAndValidity({ emitEvent: false });
  }

  /** `labelVerbatim` wins: "CNPJ" and "CUIT" are what the supplier's paperwork says. */
  protected documentLabel(type: IdentityDocumentTypeOption): string {
    return this.identityDocuments.label(type, (key) => this.translate.instant(key));
  }

  /** The example for the selected document, so the placeholder shows that country's shape. */
  protected documentExample(): string {
    const selected = this.supplierForm?.get('identityDocumentTypeCode')?.value as string | undefined;
    return this.documentTypes().find((type) => type.code === selected)?.example ?? '';
  }

  ngOnInit(): void {
    this.supplierForm = this.fb.group({
      name: ['', Validators.required],
      contactPerson: [''],
      email: ['', [Validators.email]],
      phone: [''],
      taxId: [''],
      // Which identifier `taxId` holds. Filled from the catalogue's default for this tenant's
      // country once the list arrives.
      identityDocumentTypeCode: [''],
      address: [''],
      //  Ambos existían como columna y ningún DTO los llevaba, así que el formulario no podía
      //  fijarlos. El país separa una compra local de un pago al exterior (609); el tipo de
      //  contribuyente decide qué se le retiene al proveedor.
      // The TENANT's country, not `'DO'`. This column is what separates a domestic purchase from
      // a payment abroad on the 609, so defaulting every tenant's suppliers to Dominican is a
      // wrong filing rather than a cosmetic default.
      country: [this.locale.tenantContext()?.countryCode ?? ''],
      taxpayerType: [''],
    });

    this.identityDocuments
      .list({ appliesTo: 'both', usedFor: 'invoicing' })
      .pipe(catchError(() => of([] as IdentityDocumentTypeOption[])))
      .subscribe((types) => this.applyDocumentTypes(types));

    this.supplierForm
      .get('identityDocumentTypeCode')
      ?.valueChanges.subscribe(() => this.syncTaxIdValidators());

    this.supplierId = this.route.snapshot.paramMap.get('id');
    if (this.supplierId) {
      this.isEditMode.set(true);
      this.loadSupplierData(this.supplierId);
    } else {
      this.isLoading.set(false);
    }
  }

  loadSupplierData(id: string): void {
    this.suppliersService.getSupplierById(id).subscribe({
      next: (supplier) => {
        this.supplierForm.patchValue(supplier);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('masters.supplier_form.supplier_could_not_loaded');
        this.router.navigate(['/masters/suppliers']);
      },
    });
  }

  cancel(): void {
    void this.router.navigate(['/masters/suppliers']);
  }

  saveSupplier(): void {
    if (this.supplierForm.invalid) {
      this.supplierForm.markAllAsTouched();
      //  «Completa los campos requeridos» no dice cuáles. El resumen los nombra y cada línea
      //  lleva al campo, que es lo que separa un formulario que no guarda de uno que explica.
      this.problems.set(
        draftProblems(this.supplierForm, {
          name: 'masters.supplier_form.supplier_name',
          contactPerson: 'masters.supplier_form.contact_person',
          taxId: 'masters.supplier_form.tax_id',
          address: 'masters.supplier_form.address',
          email: 'masters.supplier_form.email',
          phone: 'masters.supplier_form.phone',
          country: 'masters.supplier_form.country',
          taxpayerType: 'contacts.customer_form.taxpayer_type',
        }),
      );
      return;
    }

    this.problems.set([]);

    this.isLoading.set(true);
    const { taxpayerType, ...rest } = this.supplierForm.getRawValue();

    //  «Sin clasificar» es la opción vacía del select, y `@IsEnum` rechaza la cadena vacía —
    //  `@IsOptional()` solo perdona null e undefined—. Null es lo que significa «sin clasificar»
    //  en la columna y lo único que el validador deja pasar.
    const formValue = { ...rest, taxpayerType: taxpayerType || null };

    const operation = this.isEditMode()
      ? this.suppliersService.updateSupplier(this.supplierId!, formValue as UpdateSupplierDto)
      : this.suppliersService.createSupplier(formValue as CreateSupplierDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(this.isEditMode() ? 'masters.supplier_form.supplier_updated' : 'masters.supplier_form.supplier_created');
        //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
        //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
        //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
        void this.router.navigate(['/masters/suppliers']).then(() => this.tab?.close());
      },
      error: () => {
        this.notificationService.showError(this.isEditMode() ? 'masters.supplier_form.error_updating_supplier' : 'masters.supplier_form.error_creating_supplier');
        this.isLoading.set(false);
      },
    });
  }
}
