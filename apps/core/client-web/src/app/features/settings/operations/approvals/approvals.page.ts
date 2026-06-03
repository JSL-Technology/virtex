import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Workflow } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-approval-policies-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Flujos de Aprobación</h1>
        <p class="s-header__subtitle">Define quién aprueba qué, en qué orden y bajo qué condiciones en tu organización.</p>
      </div>
      <app-settings-empty-state title="Políticas de Aprobación"
        description="Diseña flujos de aprobación basados en reglas (monto, tipo de documento, departamento) con aprobadores secuenciales o paralelos y escalamiento automático."
        [features]="['Flujos multi-nivel con aprobadores secuenciales o paralelos','Reglas por monto, tipo de documento y departamento','Escalamiento automático por inactividad','Aprobación por correo sin necesidad de iniciar sesión','Historial completo de decisiones con comentarios']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalPoliciesPage {
  protected readonly icon = Workflow;
}
