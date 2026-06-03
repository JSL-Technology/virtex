import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Globe } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-intercompany-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Reglas Intercompany</h1>
        <p class="s-header__subtitle">Automatiza y controla las transacciones entre empresas de tu grupo corporativo.</p>
      </div>
      <app-settings-empty-state title="Gestión Intercompany"
        description="Configura las reglas para eliminar transacciones intragrupo en la consolidación, generar asientos espejo automáticos y gestionar saldos entre subsidiarias."
        [features]="features">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntercompanyPage {
  protected readonly icon = Globe;
  readonly features = [
    'Asientos espejo automáticos entre subsidiarias',
    'Eliminación de transacciones intragrupo en la consolidación',
    'Gestión de préstamos y saldos intercompany',
    'Precios de transferencia y validación de precios de mercado',
    'Reportes de reconciliación intercompany',
  ];
}
