import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, ShieldCheck } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-security-settings-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Seguridad y Auditoría</h1>
        <p class="s-header__subtitle">Políticas de contraseñas, logs de auditoría y controles de acceso organizacionales.</p>
      </div>
      <app-settings-empty-state title="Centro de Seguridad Organizacional"
        description="Configura las políticas de seguridad para tu organización, revisa los registros de auditoría y gestiona controles de acceso avanzados."
        [features]="['Políticas de contraseñas (longitud, complejidad, expiración)','Logs de auditoría filtrados por usuario, acción y fecha','Detección y alertas de accesos sospechosos','Lista blanca de IPs permitidas','Notificaciones de seguridad automáticas']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecuritySettingsPage {
  protected readonly icon = ShieldCheck;
}
