import { Component, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, FileText } from 'lucide-angular';
import { SettingsEmptyStateComponent } from '../../shared/settings-empty-state.component';

@Component({
  selector: 'app-sequence-settings-page',
  standalone: true,
  imports: [LucideAngularModule, SettingsEmptyStateComponent],
  template: `
    <div class="s-page">
      <div class="s-header">
        <h1 class="s-header__title">Secuencias Fiscales</h1>
        <p class="s-header__subtitle">Configura la numeración automática de facturas, recibos y demás documentos fiscales.</p>
      </div>
      <app-settings-empty-state title="Secuencias de Documentos"
        description="Define los prefijos, sufijos y rangos numéricos para cada tipo de documento fiscal, garantizando la correlatividad y el cumplimiento ante la autoridad tributaria."
        [features]="['Secuencias independientes por tipo de documento','Prefijos y sufijos personalizados por subsidiaria','Reinicio automático por año fiscal','Reserva de rangos para contingencia','Alertas de secuencia próxima a agotarse']">
        <lucide-icon slot="icon" [img]="icon" size="28"></lucide-icon>
      </app-settings-empty-state>
    </div>`,
  styles: [`.s-page{padding:2rem;max-width:960px}.s-header{padding-bottom:1.5rem;border-bottom:1px solid var(--border-color);margin-bottom:1.75rem}.s-header__title{font-size:1.375rem;font-weight:700;color:var(--text-primary);margin-bottom:.25rem}.s-header__subtitle{font-size:.875rem;color:var(--text-secondary)}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SequenceSettingsPage {
  protected readonly icon = FileText;
}
