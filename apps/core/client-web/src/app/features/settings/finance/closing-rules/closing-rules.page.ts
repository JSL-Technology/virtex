import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, CalendarClock } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-closing-rules-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Periodos y Cierre Fiscal</h1>
        <p class="s-header__subtitle">Gestiona los períodos contables y las reglas de bloqueo para el cierre fiscal.</p>
      </div>
      <app-settings-empty-state title="Cierre de Períodos Contables"
        description="Define y controla los períodos contables de tu organización, bloquea períodos cerrados para evitar modificaciones y programa el cierre automático."
        [features]="['Creación y gestión de períodos contables','Bloqueo automático de períodos cerrados','Cierre mensual, trimestral y anual','Permisos diferenciados para re-apertura de períodos','Proceso guiado de cierre con lista de verificación']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosingRulesPage {
  protected readonly icon = CalendarClock;
}
