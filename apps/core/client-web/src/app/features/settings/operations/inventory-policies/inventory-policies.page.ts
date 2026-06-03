import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Briefcase } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-inventory-policies-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Políticas de Inventario</h1>
        <p class="s-header__subtitle">Define las reglas de valuación, reposición y control de existencias para tu inventario.</p>
      </div>
      <app-settings-empty-state title="Políticas de Inventario"
        description="Configura el método de valuación de inventario, los umbrales de reposición automática y las reglas de conteo cíclico para mantener existencias precisas."
        [features]="['Método de valuación: PEPS, UEPS, Costo Promedio','Puntos de reorden y cantidades mínimas de stock','Conteo cíclico automatizado por categoría','Ajustes de inventario con aprobación requerida','Alertas de stock bajo y productos vencidos']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryPoliciesPage {
  protected readonly icon = Briefcase;
}
