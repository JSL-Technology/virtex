import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Percent } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-tax-rules-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Reglas de Impuestos</h1>
        <p class="s-header__subtitle">Configura las tasas impositivas aplicables a ventas, compras y retenciones por jurisdicción.</p>
      </div>
      <app-settings-empty-state title="Motor de Impuestos"
        description="Define las reglas fiscales de tu organización para que los impuestos se calculen y contabilicen automáticamente en cada transacción según la jurisdicción."
        [features]="['Tasas de ITBIS/IVA por tipo de producto o servicio','Retenciones en la fuente (ISR, ITBIS)','Impuestos por jurisdicción y subsidiaria','Exenciones fiscales por cliente o categoría','Reportes de declaración de impuestos']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxRulesPage {
  protected readonly icon = Percent;
}
