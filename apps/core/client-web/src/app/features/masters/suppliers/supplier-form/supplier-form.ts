import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { SuppliersService, CreateSupplierDto, UpdateSupplierDto } from '../../../../core/api/suppliers.service';
import { NotificationService } from '../../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { CountryNamesService } from '../../../../core/i18n/countries';

@Component({
  selector: 'app-supplier-form-page',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, DraftShellComponent],
  templateUrl: './supplier-form.html',
  styleUrls: ['./supplier-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupplierForm implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private suppliersService = inject(SuppliersService);
  private notificationService = inject(NotificationService);
  private readonly countryNames = inject(CountryNamesService);

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

  ngOnInit(): void {
    this.supplierForm = this.fb.group({
      name: ['', Validators.required],
      contactPerson: [''],
      email: ['', [Validators.email]],
      phone: [''],
      taxId: [''],
      address: [''],
      //  Ambos existían como columna y ningún DTO los llevaba, así que el formulario no podía
      //  fijarlos. El país separa una compra local de un pago al exterior (609); el tipo de
      //  contribuyente decide qué se le retiene al proveedor.
      country: ['DO'],
      taxpayerType: [''],
    });

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
        this.router.navigate(['/masters/suppliers']);
      },
      error: () => {
        this.notificationService.showError(this.isEditMode() ? 'masters.supplier_form.error_updating_supplier' : 'masters.supplier_form.error_creating_supplier');
        this.isLoading.set(false);
      },
    });
  }
}
