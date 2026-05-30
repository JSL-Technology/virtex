import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';
import { catchError, of } from 'rxjs';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  secure: boolean;
}

@Component({
  selector: 'app-smtp',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-2xl font-bold">Servidor de Correo (SMTP)</h2>
        <p class="text-gray-500 mt-1">Configuración actual del servidor de correo saliente.</p>
      </div>

      @if (loading()) {
        <p class="text-gray-500">Cargando configuración...</p>
      } @else if (error()) {
        <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {{ error() }}
        </div>
      } @else if (config()) {
        <div class="bg-white rounded-lg border max-w-xl">
          <div class="px-4 py-3 border-b bg-gray-50">
            <h3 class="font-semibold text-sm text-gray-700">Parámetros de Conexión</h3>
            <p class="text-xs text-gray-500 mt-1">Estos valores se configuran mediante variables de entorno del servidor.</p>
          </div>
          <dl class="divide-y">
            <div class="px-4 py-3 flex justify-between">
              <dt class="text-sm font-medium text-gray-600">Host SMTP</dt>
              <dd class="text-sm text-gray-900 font-mono">{{ config()!.host || '—' }}</dd>
            </div>
            <div class="px-4 py-3 flex justify-between">
              <dt class="text-sm font-medium text-gray-600">Puerto</dt>
              <dd class="text-sm text-gray-900 font-mono">{{ config()!.port }}</dd>
            </div>
            <div class="px-4 py-3 flex justify-between">
              <dt class="text-sm font-medium text-gray-600">Usuario</dt>
              <dd class="text-sm text-gray-900 font-mono">{{ config()!.user || '—' }}</dd>
            </div>
            <div class="px-4 py-3 flex justify-between">
              <dt class="text-sm font-medium text-gray-600">Conexión Segura (TLS)</dt>
              <dd class="text-sm">
                @if (config()!.secure) {
                  <span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">Habilitado</span>
                } @else {
                  <span class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs font-medium">Deshabilitado</span>
                }
              </dd>
            </div>
          </dl>
          <div class="px-4 py-3 border-t bg-gray-50">
            <p class="text-xs text-gray-500">
              Para modificar la configuración SMTP, actualice las variables de entorno
              <code class="bg-gray-200 px-1 rounded">MAIL_HOST</code>,
              <code class="bg-gray-200 px-1 rounded">MAIL_PORT</code>,
              <code class="bg-gray-200 px-1 rounded">MAIL_USER</code> y
              <code class="bg-gray-200 px-1 rounded">MAIL_PASSWORD</code> en el servidor.
            </p>
          </div>
        </div>
      }
    </div>
  `
})
export class SmtpSettingsPage implements OnInit {
  private http = inject(HttpClient);
  private apiUrl = inject(API_URL);

  config = signal<SmtpConfig | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  ngOnInit() {
    this.loading.set(true);
    this.http.get<SmtpConfig>(`${this.apiUrl}/organizations/settings/smtp`).pipe(
      catchError(() => {
        this.error.set('No se pudo cargar la configuración SMTP.');
        return of(null);
      })
    ).subscribe(data => {
      this.config.set(data);
      this.loading.set(false);
    });
  }
}
