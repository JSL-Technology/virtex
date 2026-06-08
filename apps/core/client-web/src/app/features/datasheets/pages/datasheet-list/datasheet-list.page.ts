
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Plus, FileSpreadsheet, Clock, Users, Star, Trash2 } from 'lucide-angular';

@Component({
  selector: 'app-datasheet-list',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, LucideAngularModule],
  template: `
    <div class="p-6">
      <div class="flex justify-between items-center mb-8">
        <div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-white">
            {{ 'datasheets.title' | translate }}
          </h1>
          <p class="text-slate-500 dark:text-slate-400">
            {{ 'datasheets.subtitle' | translate }}
          </p>
        </div>
        <button [routerLink]="['new']" class="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary-hover transition-colors">
          <lucide-icon [name]="PlusIcon" [size]="20"></lucide-icon>
          {{ 'datasheets.new_document' | translate }}
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div class="md:col-span-1 space-y-1">
          <button class="w-full flex items-center gap-3 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-primary">
            <lucide-icon [name]="ClockIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.recent' | translate }}
          </button>
          <button class="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
            <lucide-icon [name]="FileIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.my_documents' | translate }}
          </button>
          <button class="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
            <lucide-icon [name]="UsersIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.shared' | translate }}
          </button>
          <button class="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
            <lucide-icon [name]="StarIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.templates' | translate }}
          </button>
          <button class="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
            <lucide-icon [name]="TrashIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.trash' | translate }}
          </button>
        </div>

        <div class="md:col-span-3">
          <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table class="w-full text-left">
              <thead class="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-sm uppercase">
                <tr>
                  <th class="px-6 py-3 font-semibold">{{ 'datasheets.name' | translate }}</th>
                  <th class="px-6 py-3 font-semibold">{{ 'datasheets.owner' | translate }}</th>
                  <th class="px-6 py-3 font-semibold">{{ 'datasheets.last_modified' | translate }}</th>
                  <th class="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200 dark:divide-slate-800">
                <tr *ngFor="let doc of documents" class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" [routerLink]="[doc.id]">
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                      <div class="p-2 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg">
                        <lucide-icon [name]="FileIcon" [size]="20"></lucide-icon>
                      </div>
                      <span class="font-medium text-slate-900 dark:text-white">{{ doc.name }}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4 text-slate-600 dark:text-slate-400">{{ doc.owner }}</td>
                  <td class="px-6 py-4 text-slate-600 dark:text-slate-400">{{ doc.modifiedAt | date:'medium' }}</td>
                  <td class="px-6 py-4 text-right">
                    <button class="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg">
                      <lucide-icon name="MoreVertical" [size]="18"></lucide-icon>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `
})
export class DatasheetListPage {
  PlusIcon = Plus;
  FileIcon = FileSpreadsheet;
  ClockIcon = Clock;
  UsersIcon = Users;
  StarIcon = Star;
  TrashIcon = Trash2;

  documents = [
    { id: '1', name: 'Estado de Resultados Q1', owner: 'Juan Pérez', modifiedAt: new Date() },
    { id: '2', name: 'Análisis de Rentabilidad - Laptops', owner: 'Ana García', modifiedAt: new Date() },
  ];
}
