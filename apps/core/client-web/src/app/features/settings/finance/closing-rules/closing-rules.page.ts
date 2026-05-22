import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-closing-rules',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h2 class="text-2xl font-bold mb-4">Periodos y Cierre Fiscal</h2>
      <p class="text-gray-600">Reglas de bloqueo y cierre de periodos.</p>
    </div>
  `
})
export class ClosingRulesPage {}
