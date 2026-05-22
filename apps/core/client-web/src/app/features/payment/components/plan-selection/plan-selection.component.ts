import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaymentService } from '../../services/payment.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-plan-selection',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div class="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Selecciona tu plan
        </h2>
        <p class="mt-2 text-center text-sm text-gray-600">
          Comienza tu prueba gratuita o suscríbete ahora.
        </p>
      </div>

      <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-4xl">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <!-- Plan Starter -->
          <div class="bg-white overflow-hidden shadow rounded-lg divide-y divide-gray-200">
            <div class="px-4 py-5 sm:p-6 text-center">
              <h3 class="text-lg leading-6 font-medium text-gray-900">Starter</h3>
              <div class="mt-4 flex items-center justify-center text-5xl font-extrabold text-gray-900">
                $29
                <span class="ml-3 text-xl font-medium text-gray-500">/mes</span>
              </div>
              <p class="mt-4 text-sm text-gray-500">Para startups y pequeños negocios.</p>
              <ul class="mt-6 text-left space-y-4 text-sm text-gray-500">
                <li class="flex"><span class="mr-2">✔️</span> 5 Usuarios</li>
                <li class="flex"><span class="mr-2">✔️</span> Facturación Básica</li>
                <li class="flex"><span class="mr-2">✔️</span> Soporte por Email</li>
              </ul>
              <button
                (click)="selectPlan('starter')"
                [disabled]="isLoading()"
                class="mt-8 w-full bg-indigo-600 border border-transparent rounded-md py-2 px-4 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
                {{ isLoading() ? 'Procesando...' : 'Elegir Starter' }}
              </button>
            </div>
          </div>

          <!-- Plan Pro -->
          <div class="bg-white overflow-hidden shadow rounded-lg divide-y divide-gray-200 border-2 border-indigo-500 relative">
             <div class="absolute top-0 right-0 -mt-2 -mr-2 bg-indigo-500 text-white text-xs font-bold px-2 py-1 rounded">Popular</div>
            <div class="px-4 py-5 sm:p-6 text-center">
              <h3 class="text-lg leading-6 font-medium text-gray-900">Pro</h3>
              <div class="mt-4 flex items-center justify-center text-5xl font-extrabold text-gray-900">
                $99
                <span class="ml-3 text-xl font-medium text-gray-500">/mes</span>
              </div>
              <p class="mt-4 text-sm text-gray-500">Para empresas en crecimiento.</p>
               <ul class="mt-6 text-left space-y-4 text-sm text-gray-500">
                <li class="flex"><span class="mr-2">✔️</span> 25 Usuarios</li>
                <li class="flex"><span class="mr-2">✔️</span> Contabilidad Avanzada</li>
                <li class="flex"><span class="mr-2">✔️</span> Soporte Prioritario</li>
              </ul>
              <button
                (click)="selectPlan('pro')"
                 [disabled]="isLoading()"
                class="mt-8 w-full bg-indigo-600 border border-transparent rounded-md py-2 px-4 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
                 {{ isLoading() ? 'Procesando...' : 'Elegir Pro' }}
              </button>
            </div>
          </div>

          <!-- Plan Enterprise -->
          <div class="bg-white overflow-hidden shadow rounded-lg divide-y divide-gray-200">
            <div class="px-4 py-5 sm:p-6 text-center">
              <h3 class="text-lg leading-6 font-medium text-gray-900">Enterprise</h3>
              <div class="mt-4 flex items-center justify-center text-5xl font-extrabold text-gray-900">
                $299
                <span class="ml-3 text-xl font-medium text-gray-500">/mes</span>
              </div>
              <p class="mt-4 text-sm text-gray-500">Para grandes organizaciones.</p>
               <ul class="mt-6 text-left space-y-4 text-sm text-gray-500">
                <li class="flex"><span class="mr-2">✔️</span> Ilimitados Usuarios</li>
                <li class="flex"><span class="mr-2">✔️</span> Todo Incluido</li>
                <li class="flex"><span class="mr-2">✔️</span> Gerente de Cuenta</li>
              </ul>
              <button
                (click)="selectPlan('enterprise')"
                 [disabled]="isLoading()"
                class="mt-8 w-full bg-indigo-600 border border-transparent rounded-md py-2 px-4 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
                 {{ isLoading() ? 'Procesando...' : 'Elegir Enterprise' }}
              </button>
            </div>
          </div>
        </div>
        <p class="mt-4 text-center text-xs text-gray-500">
             Los precios están en USD. Impuestos pueden aplicar según tu región.
        </p>
      </div>
    </div>
  `
})
export class PlanSelectionComponent implements OnInit {
  private paymentService = inject(PaymentService);
  isLoading = signal(false);
  prices = signal<{ starter: string; pro: string; enterprise: string } | null>(null);

  ngOnInit() {
    this.paymentService.getConfig().subscribe({
        next: (config) => {
            this.prices.set(config.prices);
        },
        error: (err) => console.error('Error fetching payment config', err)
    });
  }

  selectPlan(planType: 'starter' | 'pro' | 'enterprise') {
    const currentPrices = this.prices();
    if (!currentPrices) {
        alert('Configuración de precios no cargada. Intente de nuevo más tarde.');
        return;
    }
    const priceId = currentPrices[planType];

    if (!priceId) {
         // Fallback/Demo mode if config is missing (e.g. dev environment without env vars)
         console.warn(`No price ID found for ${planType}, checking env vars or using placeholder`);
         // proceed or return depending on strictness.
         // For now, blocking to force proper setup.
         alert(`El precio para ${planType} no está configurado en el sistema.`);
         return;
    }

    this.isLoading.set(true);
    this.paymentService.createCheckoutSession(priceId).subscribe({
      next: (response) => {
        window.location.href = response.url;
      },
      error: (err) => {
        console.error('Error creating checkout session', err);
        this.isLoading.set(false);
        alert('Hubo un error al iniciar el pago. Por favor intenta de nuevo.');
      }
    });
  }
}
