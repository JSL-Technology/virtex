
import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ChevronRight, CheckCircle2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { DatasheetImportService, ImportModule } from '../services/datasheet-import.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-datasheet-sidebar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  template: `
    <div class="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
      <div class="flex border-b border-slate-200 dark:border-slate-800">
        <button
          (click)="activeTab = 'properties'"
          [class.border-primary]="activeTab === 'properties'"
          class="flex-1 py-3 text-sm font-medium border-b-2 transition-colors hover:text-primary"
        >
          {{ 'datasheets.properties' | translate }}
        </button>
        <button
          (click)="activeTab = 'import'"
          [class.border-primary]="activeTab === 'import'"
          class="flex-1 py-3 text-sm font-medium border-b-2 transition-colors hover:text-primary"
        >
          {{ 'datasheets.import' | translate }}
        </button>
        <button
          (click)="activeTab = 'charts'"
          [class.border-primary]="activeTab === 'charts'"
          class="flex-1 py-3 text-sm font-medium border-b-2 transition-colors hover:text-primary"
        >
          {{ 'datasheets.charts' | translate }}
        </button>
      </div>

      <div class="flex-1 overflow-auto p-4">
        <div *ngIf="activeTab === 'properties'">
           <h3 class="text-xs font-semibold uppercase text-slate-400 mb-4">{{ 'datasheets.cell_format' | translate }}</h3>
           <!-- Formatting tools -->
           <div class="space-y-4">
              <div>
                <label class="text-xs text-slate-500 block mb-1">Tipo de Dato</label>
                <select class="w-full text-sm rounded-md border-slate-200 dark:bg-slate-800 dark:border-slate-700">
                  <option>General</option>
                  <option>Número</option>
                  <option>Moneda</option>
                  <option>Fecha</option>
                </select>
              </div>
           </div>
        </div>

        <div *ngIf="activeTab === 'import'">
           <h3 class="text-xs font-semibold uppercase text-slate-400 mb-4">{{ 'datasheets.import_wizard' | translate }}</h3>

           <div *ngIf="!selectedModule" class="space-y-2">
              <button
                *ngFor="let mod of importModules"
                (click)="selectedModule = mod"
                class="w-full flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary transition-colors text-left"
              >
                <div>
                  <p class="text-sm font-medium">{{ mod.nameEn }}</p>
                  <p class="text-xs text-slate-500">{{ mod.sets.length }} conjuntos disponibles</p>
                </div>
                <lucide-icon [name]="ChevronRightIcon" [size]="16"></lucide-icon>
              </button>
           </div>

           <div *ngIf="selectedModule && !selectedSet" class="space-y-2">
              <button (click)="selectedModule = null" class="text-xs text-primary mb-2 flex items-center gap-1">← Volver</button>
              <button
                *ngFor="let set of selectedModule.sets"
                (click)="selectedSet = set"
                class="w-full p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-primary transition-colors text-left text-sm"
              >
                {{ set | titlecase }}
              </button>
           </div>

           <div *ngIf="selectedSet" class="space-y-4">
              <button (click)="selectedSet = null" class="text-xs text-primary flex items-center gap-1">← Volver</button>
              <div class="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                 <p class="text-xs font-medium mb-2">Columnas a Importar</p>
                 <div class="space-y-1">
                    <label *ngFor="let col of ['Nombre', 'Precio', 'Stock', 'Referencia']" class="flex items-center gap-2 text-sm">
                       <input type="checkbox" checked class="rounded border-slate-300 text-primary focus:ring-primary">
                       {{ col }}
                    </label>
                 </div>
              </div>
              <button
                (click)="confirmImport()"
                class="w-full py-2 bg-primary text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              >
                 <lucide-icon [name]="CheckIcon" [size]="16"></lucide-icon>
                 Confirmar Importación
              </button>
           </div>
        </div>

        <div *ngIf="activeTab === 'charts'">
           <h3 class="text-xs font-semibold uppercase text-slate-400 mb-4">{{ 'datasheets.chart_config' | translate }}</h3>
           <p class="text-sm text-slate-500 italic">Selecciona un rango de datos para crear un gráfico.</p>
        </div>
      </div>
    </div>
  `
})
export class DatasheetSidebarComponent implements OnInit {
  activeTab: 'properties' | 'import' | 'charts' = 'properties';
  importModules: ImportModule[] = [];
  selectedModule: ImportModule | null = null;
  selectedSet: string | null = null;

  @Output() importRequested = new EventEmitter<string>();

  ChevronRightIcon = ChevronRight;
  CheckIcon = CheckCircle2;

  constructor(private importService: DatasheetImportService) {}

  async ngOnInit() {
    this.importModules = await firstValueFrom(this.importService.getModules());
  }

  confirmImport() {
    if (this.selectedModule && this.selectedSet) {
      const fnName = `IMPORTAR_${this.selectedModule.id.toUpperCase()}_${this.selectedSet.toUpperCase()}`;
      // Simplified: always import a few columns
      const formula = `=${fnName}("Nombre", "Precio", "Stock")`;
      this.importRequested.emit(formula);

      // Reset wizard
      this.selectedModule = null;
      this.selectedSet = null;
    }
  }
}
