import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft } from 'lucide-angular';
import { CustomerReceiptsService } from '../../../core/services/customer-receipts';
import { NotificationService } from '../../../core/services/notification';

@Component({
  selector: 'app-customer-receipt-form-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './form.page.html',
  styleUrls: ['./form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerReceiptFormPage implements OnInit {
  protected readonly BackIcon = ChevronLeft;

  private fb = inject(FormBuilder);
  private router = inject(Router);
  private receiptsService = inject(CustomerReceiptsService);
  private notificationService = inject(NotificationService);

  form!: FormGroup;
  isLoading = signal(false);

  ngOnInit(): void {
    this.form = this.fb.group({
      customerId: ['', [Validators.required]],
      paymentDate: ['', [Validators.required]],
      amount: [0, [Validators.required, Validators.min(0.01)]],
      notes: [''],
      // In a real app, this would be a more complex control to select invoices
      invoicesToApply: this.fb.array([]),
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.notificationService.showError('Por favor, completa todos los campos requeridos.');
      return;
    }

    this.isLoading.set(true);
    // The service needs a 'create' method. This is a placeholder call.
    // this.receiptsService.create(this.form.value).subscribe(...)
    console.log('La creación de recibos aún no está conectada al backend.');
    this.isLoading.set(false);
    // On success: this.router.navigate(['/customer-receipts']);
  }
}
