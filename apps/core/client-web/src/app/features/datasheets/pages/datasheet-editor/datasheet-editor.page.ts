
import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Save, Download, Share2, History, Settings, RefreshCw, BarChart3, Database } from 'lucide-angular';
import { DatasheetGridComponent } from '../../components/datasheet-grid.component';
import { DatasheetSidebarComponent } from '../../components/datasheet-sidebar.component';
import { DatasheetVariablesService } from '../../services/datasheet-variables.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-datasheet-editor',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, LucideAngularModule, DatasheetGridComponent, DatasheetSidebarComponent, FormsModule],
  template: `
    <div class="flex flex-col h-screen bg-slate-50 dark:bg-slate-950">
      <!-- Toolbar -->
      <div class="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 shrink-0">
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <div class="p-1.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-md">
              <lucide-icon name="FileSpreadsheet" [size]="18"></lucide-icon>
            </div>
            <input type="text" [value]="bookName" class="bg-transparent border-none font-medium focus:ring-0 text-slate-900 dark:text-white" />
          </div>
          <div class="h-6 w-px bg-slate-200 dark:border-slate-700"></div>
          <div class="flex items-center gap-1">
            <button (click)="saveBook()" class="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-600 dark:text-slate-400" title="Guardar">
              <lucide-icon [name]="SaveIcon" [size]="18"></lucide-icon>
            </button>
            <button class="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-600 dark:text-slate-400" title="Historial">
              <lucide-icon [name]="HistoryIcon" [size]="18"></lucide-icon>
            </button>
            <button (click)="refreshGrid()" class="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-600 dark:text-slate-400" title="Actualizar Datos">
              <lucide-icon [name]="RefreshIcon" [size]="18"></lucide-icon>
            </button>
            <div class="h-6 w-px bg-slate-200 dark:border-slate-700 mx-1"></div>
            <div class="flex items-center gap-2 px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">
               <span class="text-[10px] font-bold uppercase text-slate-400">{{ isSnapshot ? 'Snapshot' : 'En Vivo' }}</span>
               <button (click)="toggleMode()" class="w-8 h-4 rounded-full bg-slate-300 dark:bg-slate-600 relative transition-colors" [class.bg-primary]="!isSnapshot">
                  <div class="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform" [class.translate-x-4]="!isSnapshot"></div>
               </button>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button class="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-sm text-slate-600 dark:text-slate-400">
            <lucide-icon [name]="DatabaseIcon" [size]="16"></lucide-icon>
            {{ 'datasheets.import_erp' | translate }}
          </button>
          <button class="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-sm text-slate-600 dark:text-slate-400">
            <lucide-icon [name]="ChartIcon" [size]="16"></lucide-icon>
            {{ 'datasheets.insert_chart' | translate }}
          </button>
          <div class="h-6 w-px bg-slate-200 dark:border-slate-700 mx-1"></div>
          <button class="flex items-center gap-2 px-3 py-1.5 bg-primary text-white rounded-md text-sm font-medium">
            <lucide-icon [name]="ShareIcon" [size]="16"></lucide-icon>
            {{ 'datasheets.share' | translate }}
          </button>
        </div>
      </div>

      <!-- Formula Bar -->
      <div class="h-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-4 gap-2 shrink-0 relative">
        <div class="w-12 text-sm font-mono text-slate-400 text-center">B2</div>
        <div class="h-6 w-px bg-slate-200 dark:border-slate-700"></div>
        <div class="text-slate-400 italic font-serif px-2">fx</div>
        <input
          type="text"
          [(ngModel)]="formulaValue"
          (input)="onFormulaInput($event)"
          class="flex-1 bg-transparent border-none text-sm focus:ring-0 text-slate-900 dark:text-white"
          placeholder="Introduce una fórmula o valor..."
        />

        <!-- Autocomplete Menu -->
        <div *ngIf="showSuggestions" class="absolute left-24 top-full mt-1 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden">
           <div class="p-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-[10px] font-bold text-slate-400 uppercase">Variables del ERP</div>
           <div class="max-h-60 overflow-auto">
              <button
                *ngFor="let suggestion of suggestions"
                (click)="selectSuggestion(suggestion)"
                class="w-full px-4 py-2 hover:bg-primary/10 text-left transition-colors border-b border-slate-50 dark:border-slate-700 last:border-none"
              >
                <div class="flex justify-between items-center mb-0.5">
                  <span class="text-sm font-mono font-bold text-primary">{{ suggestion.nameEn }}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 uppercase">{{ suggestion.module }}</span>
                </div>
                <p class="text-xs text-slate-500 line-clamp-1">{{ suggestion.descriptionEn }}</p>
              </button>
           </div>
        </div>
      </div>

      <!-- Grid Area -->
      <div class="flex-1 relative overflow-hidden flex">
        <div class="flex-1 bg-white dark:bg-slate-900 overflow-hidden">
           <app-datasheet-grid></app-datasheet-grid>
        </div>

        <!-- Sidebar -->
        <div class="w-72 shrink-0">
           <app-datasheet-sidebar (importRequested)="onImportRequested($event)"></app-datasheet-sidebar>
        </div>
      </div>

      <!-- Footer / Sheet Tabs -->
      <div class="h-10 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center px-4 shrink-0">
        <div class="flex gap-px bg-slate-200 dark:bg-slate-800">
           <button class="px-4 py-2 text-xs font-medium bg-white dark:bg-slate-900 text-primary border-b-2 border-primary">Hoja 1</button>
           <button class="px-4 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-800/50 text-slate-500 hover:bg-white dark:hover:bg-slate-900">Hoja 2</button>
        </div>
        <button class="ml-2 p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400">
           <lucide-icon name="Plus" [size]="14"></lucide-icon>
        </button>
      </div>
    </div>
  `
})
export class DatasheetEditorPage implements OnInit {
  @ViewChild(DatasheetGridComponent) grid!: DatasheetGridComponent;

  SaveIcon = Save;
  HistoryIcon = History;
  RefreshIcon = RefreshCw;
  DatabaseIcon = Database;
  ChartIcon = BarChart3;
  ShareIcon = Share2;
  SettingsIcon = Settings;

  bookName = 'Libro sin título';
  bookId: string | null = null;
  isSnapshot = false;

  formulaValue = '';
  showSuggestions = false;
  suggestions: any[] = [];
  allVariables: any[] = [];

  constructor(
    private route: ActivatedRoute,
    private variablesService: DatasheetVariablesService
  ) {}

  async ngOnInit(): Promise<void> {
    this.bookId = this.route.snapshot.paramMap.get('id');
    if (this.bookId && this.bookId !== 'new') {
       const book = await firstValueFrom(this.variablesService.getBook(this.bookId));
       this.bookName = book.name;
       this.isSnapshot = book.mode === 'snapshot';
    }
    this.allVariables = await firstValueFrom(this.variablesService.getVariables());
  }

  toggleMode() {
    this.isSnapshot = !this.isSnapshot;
  }

  onFormulaInput(event: any) {
    const val = this.formulaValue;
    if (val.startsWith('=')) {
      const query = val.substring(1).toUpperCase();
      this.suggestions = this.allVariables.filter(v =>
        v.nameEn.toUpperCase().includes(query) || v.nameEs.toUpperCase().includes(query)
      );
      this.showSuggestions = this.suggestions.length > 0;
    } else {
      this.showSuggestions = false;
    }
  }

  selectSuggestion(v: any) {
    this.formulaValue = `=${v.nameEn}`; // Default to English name for consistency in storage
    this.showSuggestions = false;
    this.onImportRequested(this.formulaValue);
  }

  async saveBook() {
    const hot = (window as any).Handsontable.getInstance(document.getElementById(this.grid.id));
    const data = hot.getData();

    await firstValueFrom(this.variablesService.saveBook({
       id: this.bookId || undefined,
       name: this.bookName,
       mode: 'live',
       sheets: [{ name: 'Sheet1', cells: data }]
    }));
    alert('Libro guardado correctamente');
  }

  onImportRequested(formula: string) {
    this.grid.setCellFormula(formula);
    this.refreshGrid();
  }

  refreshGrid() {
    this.grid.refreshData();
  }
}
