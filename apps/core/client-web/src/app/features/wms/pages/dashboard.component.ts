
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-wms-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-4">Warehouse Management System (WMS)</h1>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <h2 class="text-xl font-semibold mb-2">Inventory Real-time</h2>
          <p class="text-gray-500 dark:text-gray-400">Track stock levels across multiple warehouses.</p>
        </div>
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <h2 class="text-xl font-semibold mb-2">Landed Costs</h2>
          <p class="text-gray-500 dark:text-gray-400">Calculate accurate product costs including freight and duties.</p>
        </div>
      </div>
    </div>
  `
})
export class WmsDashboardComponent {}
