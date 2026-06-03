import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Calculator } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-accounting-settings-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Preferencias Contables</h1>
        <p class="s-header__subtitle">Define las cuentas contables predeterminadas y las reglas de registro para tu organización.</p>
      </div>
      <app-settings-empty-state title="Preferencias Contables"
        description="Configura las cuentas del plan de cuentas que se usarán automáticamente en cada transacción, eliminando errores de asignación manual."
        [features]="['Cuenta por cobrar predeterminada','Cuenta por pagar predeterminada','Cuenta de ingresos por ventas','Cuenta de ganancias y pérdidas en diferencial cambiario','Cuenta de depreciación acumulada','Cuenta de impuestos por ventas y compras']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountingSettingsPage {
  protected readonly icon = Calculator;
}
