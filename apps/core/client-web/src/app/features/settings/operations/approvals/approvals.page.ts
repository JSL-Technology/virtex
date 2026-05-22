import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-approvals',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h2 class="text-2xl font-bold mb-4">Políticas de Aprobación</h2>
      <p class="text-gray-600">Flujos de trabajo y aprobaciones.</p>
    </div>
  `
})
export class ApprovalPoliciesPage {}
