import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-accounting-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h2 class="text-2xl font-bold mb-4">Preferencias Contables</h2>
      <p class="text-gray-600">Configuración de cuentas por defecto y periodos.</p>
    </div>
  `
})
export class AccountingSettingsPage {}
