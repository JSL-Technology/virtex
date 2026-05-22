import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h2 class="text-2xl font-bold mb-4">Integraciones (API)</h2>
      <p class="text-gray-600">Gestión de API Keys y Webhooks.</p>
    </div>
  `
})
export class IntegrationSettingsPage {}
