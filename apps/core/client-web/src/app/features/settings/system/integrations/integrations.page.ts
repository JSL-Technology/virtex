import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';
import { catchError, of } from 'rxjs';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: 'connected' | 'disconnected' | 'error';
}

interface PaymentConfig {
  prices: Record<string, string>;
}

@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-2xl font-bold">Integraciones</h2>
        <p class="text-gray-500 mt-1">Estado de las integraciones con servicios externos.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (integration of integrations(); track integration.id) {
          <div class="bg-white rounded-lg border p-4 flex items-start gap-4">
            <div class="text-3xl">{{ integration.icon }}</div>
            <div class="flex-1">
              <div class="flex items-center justify-between mb-1">
                <h3 class="font-semibold text-gray-900">{{ integration.name }}</h3>
                <span class="px-2 py-0.5 rounded-full text-xs font-medium"
                  [class]="getStatusClass(integration.status)">
                  {{ getStatusLabel(integration.status) }}
                </span>
              </div>
              <p class="text-sm text-gray-500">{{ integration.description }}</p>
            </div>
          </div>
        }
      </div>

      <div class="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 class="font-semibold text-blue-900 mb-2">Información de la API</h3>
        <p class="text-sm text-blue-700">
          Para conectar integraciones externas, utilice la API REST de Virteex.
          Las credenciales y webhooks se gestionan a través de las variables de entorno del servidor.
        </p>
      </div>
    </div>
  `
})
export class IntegrationSettingsPage implements OnInit {
  private http = inject(HttpClient);
  private apiUrl = inject(API_URL);

  integrations = signal<Integration[]>([
    { id: 'stripe', name: 'Stripe', description: 'Procesamiento de pagos y suscripciones.', icon: '💳', status: 'disconnected' },
    { id: 'smtp', name: 'Correo SMTP', description: 'Envío de correos electrónicos del sistema.', icon: '✉️', status: 'disconnected' },
    { id: 'recaptcha', name: 'reCAPTCHA', description: 'Protección contra bots en formularios.', icon: '🤖', status: 'disconnected' },
    { id: 'redis', name: 'Redis', description: 'Caché de sesiones y colas de tareas.', icon: '⚡', status: 'disconnected' },
    { id: 'sms', name: 'SMS (2FA)', description: 'Verificación por SMS para autenticación de dos factores.', icon: '📱', status: 'disconnected' },
    { id: 'pushNotif', name: 'Notificaciones Push', description: 'Notificaciones en tiempo real a dispositivos.', icon: '🔔', status: 'disconnected' },
  ]);

  ngOnInit() {
    this.http.get<PaymentConfig>(`${this.apiUrl}/payment/config`).pipe(
      catchError(() => of(null))
    ).subscribe(config => {
      if (config?.prices) {
        this.updateStatus('stripe', 'connected');
      }
    });

    this.http.get<{ host: string }>(`${this.apiUrl}/organizations/settings/smtp`).pipe(
      catchError(() => of(null))
    ).subscribe(smtp => {
      if (smtp?.host) {
        this.updateStatus('smtp', 'connected');
      }
    });
  }

  private updateStatus(id: string, status: Integration['status']) {
    this.integrations.update(list =>
      list.map(i => i.id === id ? { ...i, status } : i)
    );
  }

  getStatusClass(status: Integration['status']): string {
    const map: Record<string, string> = {
      connected: 'bg-green-100 text-green-700',
      disconnected: 'bg-gray-100 text-gray-500',
      error: 'bg-red-100 text-red-700',
    };
    return map[status] || 'bg-gray-100 text-gray-500';
  }

  getStatusLabel(status: Integration['status']): string {
    const map: Record<string, string> = {
      connected: 'Conectado',
      disconnected: 'No configurado',
      error: 'Error',
    };
    return map[status] || 'Desconocido';
  }
}
