
import { Component, OnInit, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Save, Download, Share2, History, Settings, RefreshCw, BarChart3, Database, FileSpreadsheet, Plus } from 'lucide-angular';
import { DatasheetGridComponent } from '../../components/datasheet-grid.component';
import { DatasheetSidebarComponent } from '../../components/datasheet-sidebar.component';
import { DatasheetVariablesService } from '../../services/datasheet-variables.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-datasheet-editor',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, LucideAngularModule, DatasheetGridComponent, DatasheetSidebarComponent, FormsModule],
  styleUrl: './datasheet-editor.page.scss',
  template: `
    <div class="editor-container">
      <!-- Toolbar -->
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="book-info">
            <div class="icon-wrapper">
              <lucide-icon [name]="FileSpreadsheetIcon" [size]="18"></lucide-icon>
            </div>
            <input type="text" [value]="bookName()" (input)="bookName.set($any($event.target).value)" />
          </div>
          <div class="separator"></div>
          <div class="actions">
            <button (click)="saveBook()" class="btn-icon" title="Guardar">
              <lucide-icon [name]="SaveIcon" [size]="18"></lucide-icon>
            </button>
            <button class="btn-icon" title="Historial">
              <lucide-icon [name]="HistoryIcon" [size]="18"></lucide-icon>
            </button>
            <button (click)="refreshGrid()" class="btn-icon" title="Actualizar Datos">
              <lucide-icon [name]="RefreshIcon" [size]="18"></lucide-icon>
            </button>
            <div class="separator"></div>
            <div class="mode-toggle">
               <span class="mode-label">{{ isSnapshot ? 'Snapshot' : 'En Vivo' }}</span>
               <button (click)="toggleMode()" class="toggle-switch" [class.active]="!isSnapshot">
                  <div class="toggle-dot"></div>
               </button>
            </div>
          </div>
        </div>

        <div class="toolbar-right">
          <button class="btn-secondary">
            <lucide-icon [name]="DatabaseIcon" [size]="16"></lucide-icon>
            {{ 'datasheets.import_erp' | translate }}
          </button>
          <button class="btn-secondary">
            <lucide-icon [name]="ChartIcon" [size]="16"></lucide-icon>
            {{ 'datasheets.insert_chart' | translate }}
          </button>
          <div class="separator"></div>
          <button class="btn-primary">
            <lucide-icon [name]="ShareIcon" [size]="16"></lucide-icon>
            {{ 'datasheets.share' | translate }}
          </button>
        </div>
      </div>

      <!-- Formula Bar -->
      <div class="formula-bar">
        <div class="cell-address">B2</div>
        <div class="separator"></div>
        <div class="fx-icon">fx</div>
        <input
          type="text"
          [(ngModel)]="formulaValue"
          (input)="onFormulaInput($event)"
          placeholder="Introduce una fórmula o valor..."
        />

        <!-- Autocomplete Menu -->
        <div *ngIf="showSuggestions" class="autocomplete-menu">
           <div class="menu-header">Variables del ERP</div>
           <div class="suggestions-list">
              <button
                *ngFor="let suggestion of suggestions"
                (click)="selectSuggestion(suggestion)"
                class="suggestion-item"
              >
                <div class="item-header">
                  <span class="variable-name">{{ suggestion.nameEn }}</span>
                  <span class="module-badge">{{ suggestion.module }}</span>
                </div>
                <p class="item-description">{{ suggestion.descriptionEn }}</p>
              </button>
           </div>
        </div>
      </div>

      <!-- Grid Area -->
      <div class="grid-area">
        <div class="spreadsheet-container">
           <app-datasheet-grid></app-datasheet-grid>
        </div>

        <!-- Sidebar -->
        <div class="sidebar-container">
           <app-datasheet-sidebar (importRequested)="onImportRequested($event)"></app-datasheet-sidebar>
        </div>
      </div>

      <!-- Footer / Sheet Tabs -->
      <div class="footer">
        <div class="tabs-container">
           <button class="tab-button active">Hoja 1</button>
           <button class="tab-button inactive">Hoja 2</button>
        </div>
        <button class="add-sheet-btn">
           <lucide-icon [name]="PlusIcon" [size]="14"></lucide-icon>
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
  FileSpreadsheetIcon = FileSpreadsheet;
  PlusIcon = Plus;

  bookName = signal<string>('Libro sin título');
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
       this.bookName.set(book.name);
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
       name: this.bookName(),
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
