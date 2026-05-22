import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-tax-rules',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h2 class="text-2xl font-bold mb-4">Reglas de Impuestos</h2>
      <p class="text-gray-600">Configuración avanzada de impuestos.</p>
    </div>
  `
})
export class TaxRulesPage {}
