
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-manufacturing-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-4">Manufacturing & Production (MRP)</h1>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <h2 class="text-xl font-semibold mb-2">Production Orders</h2>
          <p class="text-gray-500 dark:text-gray-400">Manage active work orders and production schedules.</p>
        </div>
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <h2 class="text-xl font-semibold mb-2">Bill of Materials</h2>
          <p class="text-gray-500 dark:text-gray-400">Configure product structures and component lists.</p>
        </div>
        <div class="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
          <h2 class="text-xl font-semibold mb-2">Work Centers</h2>
          <p class="text-gray-500 dark:text-gray-400">Monitor station capacity and efficiency.</p>
        </div>
      </div>
    </div>
  `
})
export class ManufacturingDashboardComponent {}
