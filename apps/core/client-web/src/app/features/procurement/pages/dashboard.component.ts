
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-procurement-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-4">Advanced Procurement & Supplier Portal</h1>
      <p class="mb-6 text-gray-600 dark:text-gray-300">Manage RFQs, Purchase Requisitions, and Supplier interactions.</p>
    </div>
  `
})
export class ProcurementDashboardComponent {}
