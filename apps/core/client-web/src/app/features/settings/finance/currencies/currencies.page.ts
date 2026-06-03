import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, ArrowRightLeft } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-currencies-settings-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Multimoneda y Tasas de Cambio</h1>
        <p class="s-header__subtitle">Gestiona las monedas activas y las tasas de cambio para transacciones internacionales.</p>
      </div>
      <app-settings-empty-state title="Multimoneda"
        description="Activa múltiples monedas para tus transacciones, define la moneda funcional de cada subsidiaria y configura la actualización automática de tasas de cambio."
        [features]="['Moneda base y monedas secundarias activas','Actualización automática de tasas de cambio (Banco Central, ECB)','Revaluación periódica de saldos en moneda extranjera','Diferencial cambiario reconocido automáticamente','Reportes de ganancia/pérdida por tipo de cambio']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrencySettingsPage {
  protected readonly icon = ArrowRightLeft;
}
