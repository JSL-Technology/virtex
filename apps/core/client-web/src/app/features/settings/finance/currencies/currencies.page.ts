import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-currencies',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h2 class="text-2xl font-bold mb-4">Multimoneda y Tasas</h2>
      <p class="text-gray-600">Configuración de monedas y revaluación.</p>
    </div>
  `
})
export class CurrencySettingsPage {}
