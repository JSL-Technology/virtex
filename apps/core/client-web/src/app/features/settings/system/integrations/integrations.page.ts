import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Plug } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-integration-settings-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Integraciones y API</h1>
        <p class="s-header__subtitle">Gestiona API keys, webhooks y conexiones con servicios externos.</p>
      </div>
      <app-settings-empty-state title="Centro de Integraciones"
        description="Conecta Virteex con tus herramientas empresariales, crea API keys para desarrolladores y configura webhooks para eventos en tiempo real."
        [features]="['API keys con permisos granulares y expiración configurable','Webhooks para notificaciones de eventos en tiempo real','Integraciones con ERP, CRM y herramientas de productividad','Documentación interactiva de la API REST','Registro de llamadas y monitoreo de salud de integraciones']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntegrationSettingsPage {
  protected readonly icon = Plug;
}
