import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, CreditCard, Download, CheckCircle, Info } from 'lucide-angular';
import { toSignal } from '@angular/core/rxjs-interop';
import { BillingService, Subscription, PaymentMethod, PaymentHistoryItem } from '../../../core/services/billing';

@Component({
  selector: 'app-billing-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './billing.page.html',
  styleUrls: ['./billing.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillingPage implements OnInit {
  private billingService = inject(BillingService);

  // Íconos
  protected readonly CreditCardIcon = CreditCard;
  protected readonly DownloadIcon = Download;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly InfoIcon = Info;

  // Convertimos los datos del servicio en señales
  subscription = toSignal(this.billingService.getSubscription());
  paymentMethod = toSignal(this.billingService.getPaymentMethod());
  paymentHistory = toSignal(this.billingService.getPaymentHistory());

  // Estado para la UI
  selectedPlan = signal<string>('pro');
  isSaving = signal(false);
  availablePlans = this.billingService.plans;

  usageMetrics = toSignal(this.billingService.getUsage(), { initialValue: [] });

  ngOnInit(): void {
    // Inicializa el plan seleccionado con el plan actual del usuario
    const currentPlanId = this.subscription()?.planId;
    if (currentPlanId) {
      this.selectedPlan.set(currentPlanId);
    }
  }

  selectPlan(planId: string): void {
    this.selectedPlan.set(planId);
  }

  updatePlan(): void {
    this.isSaving.set(true);
    this.billingService.changePlan(this.selectedPlan()).subscribe({
      next: () => {
        // En una app real, recargaríamos los datos de la suscripción
        console.log('Plan actualizado con éxito');
        this.isSaving.set(false);
      },
      error: () => {
        console.error('Error al actualizar el plan');
        this.isSaving.set(false);
      }
    });
  }
}