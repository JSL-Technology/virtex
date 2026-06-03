import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Mail } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-smtp-settings-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Servidor de Correo (SMTP)</h1>
        <p class="s-header__subtitle">Configura el servidor de correo saliente para notificaciones y comunicaciones del sistema.</p>
      </div>
      <app-settings-empty-state title="Configuración de Correo"
        description="Define el servidor SMTP de tu organización para que todas las notificaciones del sistema (facturas, alertas, invitaciones) se envíen desde tu dominio corporativo."
        [features]="['Configuración SMTP con soporte TLS/SSL','Verificación de conexión con servidor de prueba','Remitente personalizado (nombre y dirección)','Plantillas de correo personalizables por evento','Historial de envíos y registro de errores']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SmtpSettingsPage {
  protected readonly icon = Mail;
}
