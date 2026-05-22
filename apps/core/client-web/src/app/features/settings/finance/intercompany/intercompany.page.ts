import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-intercompany',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h2 class="text-2xl font-bold mb-4">Reglas Intercompany</h2>
      <p class="text-gray-600">Automatización de operaciones entre empresas.</p>
    </div>
  `
})
export class IntercompanyPage {}
