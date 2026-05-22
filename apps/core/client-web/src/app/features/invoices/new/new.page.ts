import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  FormArray,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { InvoicesService, CreateInvoiceDto } from '../../../core/services/invoices';
import { CustomersService } from '../../../core/api/customers.service';
import { InventoryService } from '../../../core/api/inventory.service';
import { CurrenciesService, Currency } from '../../../core/api/currencies.service';
import { Customer } from '../../../core/models/customer.model';
import { Product } from '../../../core/models/product.model';
import { NotificationService } from '../../../core/services/notification';
import { CommonModule, DecimalPipe } from '@angular/common';
import { InvoiceToolbarComponent } from '../components/invoice-toolbar/invoice-toolbar.component';
import { InvoiceSelectionDialogComponent } from '../components/invoice-selection-dialog/invoice-selection-dialog.component';
import { ViewChild } from '@angular/core';

@Component({
  selector: 'app-new-invoice-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, DecimalPipe, InvoiceToolbarComponent, InvoiceSelectionDialogComponent],
  templateUrl: './new.page.html',
  styleUrls: ['./new.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewInvoicePage implements OnInit {
  private fb = inject(FormBuilder);
  protected router = inject(Router);
  private route = inject(ActivatedRoute);
  private invoicesService = inject(InvoicesService);
  private customersService = inject(CustomersService);
  private inventoryService = inject(InventoryService);
  private currenciesService = inject(CurrenciesService);
  private notificationService = inject(NotificationService);

  invoiceForm: FormGroup;
  customers = signal<Customer[]>([]);
  products = signal<Product[]>([]);
  currencies = signal<Currency[]>([]);
  isSaving = signal(false);
  activeTab = signal<'content' | 'logistics' | 'finance'>('content');

  @ViewChild('selectionDialog') selectionDialog!: InvoiceSelectionDialogComponent;

  constructor() {
    this.invoiceForm = this.fb.group({
      customerId: ['', Validators.required],
      issueDate: [new Date().toISOString().split('T')[0], Validators.required],
      dueDate: ['', Validators.required],
      currencyCode: ['USD', Validators.required],
      notes: [''],
      lineItems: this.fb.array([this.createLineItem()]),
    });
  }

  ngOnInit(): void {
    this.loadInitialData();
    this.checkCopyFrom();
  }

  private checkCopyFrom(): void {
    const copyFromId = this.route.snapshot.queryParamMap.get('copyFrom');
    if (copyFromId) {
      this.invoicesService.getInvoiceById(copyFromId).subscribe(invoice => {
        this.invoiceForm.patchValue({
          customerId: (invoice as any).customerId || (invoice as any).customer?.id,
          currencyCode: invoice.currencyCode,
          notes: `Copiado de la factura ${invoice.invoiceNumber}. ${invoice.notes || ''}`
        });

        this.lineItems.clear();
        invoice.lineItems.forEach(item => {
          const group = this.createLineItem();
          group.patchValue({
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            price: item.price,
            taxRate: item.taxRate
          });
          this.lineItems.push(group);
        });

        this.notificationService.showInfo(`Datos cargados desde la factura ${invoice.invoiceNumber}`);
      });
    }
  }

  loadInitialData(): void {
    this.customersService.getCustomers().subscribe((data) => this.customers.set(data));
    this.inventoryService.getProducts().subscribe((data) => this.products.set(data));
    this.currenciesService.getCurrencies().subscribe((data) => this.currencies.set(data));
  }

  get lineItems(): FormArray {
    return this.invoiceForm.get('lineItems') as FormArray;
  }

  createLineItem(): FormGroup {
    return this.fb.group({
      productId: ['', Validators.required],
      description: [''],
      quantity: [1, [Validators.required, Validators.min(1)]],
      price: [0, [Validators.required, Validators.min(0)]],
      taxRate: [0.18, [Validators.required, Validators.min(0), Validators.max(1)]],
    });
  }

  addLineItem(): void {
    this.lineItems.push(this.createLineItem());
  }

  removeLineItem(index: number): void {
    if (this.lineItems.length > 1) {
      this.lineItems.removeAt(index);
    }
  }

  onProductSelect(index: number): void {
    const productId = this.lineItems.at(index).get('productId')?.value;
    const selectedProduct = this.products().find((p) => p.id === productId);
    if (selectedProduct) {
      this.lineItems.at(index).patchValue({
        description: selectedProduct.name,
        price: selectedProduct.price,
      });
    }
  }

  get totals() {
    let subtotal = 0;
    let tax = 0;

    this.lineItems.controls.forEach((control) => {
      const qty = control.get('quantity')?.value || 0;
      const price = control.get('price')?.value || 0;
      const taxRate = control.get('taxRate')?.value || 0;

      const lineTotal = qty * price;
      subtotal += lineTotal;
      tax += lineTotal * taxRate;
    });

    return {
      subtotal,
      tax,
      total: subtotal + tax
    };
  }

  validateStock(index: number): boolean {
    const control = this.lineItems.at(index);
    const productId = control.get('productId')?.value;
    const qty = control.get('quantity')?.value;

    if (!productId || !qty) return true;

    const product = this.products().find(p => p.id === productId);
    if (product && qty > product.stock) {
      return false;
    }
    return true;
  }

  handleCopyFrom(): void {
    this.selectionDialog.open((invoice) => {
      this.populateFromInvoice(invoice);
    });
  }

  private populateFromInvoice(invoice: any): void {
    this.invoiceForm.patchValue({
      customerId: invoice.customerId || (invoice as any).customerId || (invoice as any).customer?.id,
      currencyCode: invoice.currencyCode,
      notes: `Copiado de la factura ${invoice.invoiceNumber}. ${invoice.notes || ''}`
    });

    this.lineItems.clear();
    invoice.lineItems.forEach((item: any) => {
      const group = this.createLineItem();
      group.patchValue({
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        price: item.price,
        taxRate: item.taxRate
      });
      this.lineItems.push(group);
    });

    this.notificationService.showSuccess(`Datos cargados desde la factura ${invoice.invoiceNumber}`);
  }

  onSubmit(): void {
    if (this.invoiceForm.invalid) {
      this.invoiceForm.markAllAsTouched();
      this.notificationService.showError('Por favor, completa todos los campos requeridos.');
      return;
    }

    this.isSaving.set(true);
    const formValue = this.invoiceForm.getRawValue();
    const payload: CreateInvoiceDto = {
      customerId: formValue.customerId,
      issueDate: formValue.issueDate,
      dueDate: formValue.dueDate,
      currencyCode: formValue.currencyCode,
      notes: formValue.notes,
      lineItems: formValue.lineItems.map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        description: item.description,
        taxRate: item.taxRate
      }))
    };

    this.invoicesService.createInvoice(payload).subscribe({
      next: () => {
        this.notificationService.showSuccess('Factura creada exitosamente.');
        this.router.navigate(['/invoices']);
      },
      error: (err) => {
        console.error('Error body:', err.error);
        const errorMessage = err.error?.message || err.message || 'Error desconocido al crear la factura.';
        this.notificationService.showError(`Error al crear la factura: ${errorMessage}`);
        this.isSaving.set(false);
      },
    });
  }
}
