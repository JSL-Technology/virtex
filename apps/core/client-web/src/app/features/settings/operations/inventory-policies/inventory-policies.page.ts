import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-inventory-policies',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h2 class="text-2xl font-bold mb-4">Políticas de Inventario</h2>
      <p class="text-gray-600">Reglas de stock y valuación.</p>
    </div>
  `
})
export class InventoryPoliciesPage {}
