
import { Component, OnInit, ViewChild, signal, inject } from '@angular/core';
import { NotificationService } from '../../../../core/services/notification';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, Save, RefreshCw, Database, FileSpreadsheet } from 'lucide-angular';
import { DatasheetGridComponent } from '../../components/datasheet-grid.component';
import { DatasheetSidebarComponent } from '../../components/datasheet-sidebar.component';
import { DatasheetVariablesService } from '../../services/datasheet-variables.service';
import { firstValueFrom } from 'rxjs';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

@Component({
  selector: 'app-datasheet-editor',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, LucideAngularModule, DatasheetGridComponent, DatasheetSidebarComponent, FormsModule, ...VX_FORM_A11Y],
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
            <button type="button" (click)="saveBook()" class="btn-icon" [title]="'datasheets.save' | translate" [attr.aria-label]="'datasheets.save' | translate">
              <lucide-icon [name]="SaveIcon" [size]="18"></lucide-icon>
            </button>
            <button type="button" (click)="refreshGrid()" class="btn-icon" [title]="'datasheets.refresh_data' | translate" [attr.aria-label]="'datasheets.refresh_data' | translate">
              <lucide-icon [name]="RefreshIcon" [size]="18"></lucide-icon>
            </button>
            <div class="separator"></div>
            <div class="mode-toggle">
               <span class="mode-label">{{ (isSnapshot ? 'datasheets.mode_snapshot' : 'datasheets.mode_live') | translate }}</span>
               <button (click)="toggleMode()" class="toggle-switch" [class.active]="!isSnapshot">
                  <div class="toggle-dot"></div>
               </button>
            </div>
          </div>
        </div>

        <!-- History, Share and Insert chart were buttons with nothing behind them (QA R3-A06); they
             return when they do something. «Import from the ERP» opens the wizard. -->
        <div class="toolbar-right">
          <button type="button" class="btn-secondary" (click)="sidebarTab.set('import')">
            <lucide-icon [name]="DatabaseIcon" [size]="16"></lucide-icon>
            {{ 'datasheets.import_erp' | translate }}
          </button>
        </div>
      </div>

      <!-- Formula Bar -->
      <div class="formula-bar">
        <div class="cell-address">{{ 'datasheets.formula' | translate }}</div>
        <div class="separator"></div>
        <div class="fx-icon">fx</div>
        <input
          type="text"
          [(ngModel)]="formulaValue"
          (input)="onFormulaInput($event)"
          [placeholder]="'datasheets.formula_placeholder' | translate"
        />

        <!-- Autocomplete Menu -->
        <div *ngIf="showSuggestions" class="autocomplete-menu">
           <div class="menu-header">{{ 'datasheets.erp_variables' | translate }}</div>
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
           <app-datasheet-sidebar [activeTab]="sidebarTab()" (importRequested)="onImportRequested($event)" (cellTypeChange)="grid.setCellType($event)"></app-datasheet-sidebar>
        </div>
      </div>

      <!-- One sheet: a second tab and a «+» that did nothing implied a multi-sheet book that does
           not exist (QA R3-A06). -->
      <div class="footer">
        <div class="tabs-container">
           <span class="tab-button active">{{ 'datasheets.sheet_numbered' | translate: { number: 1 } }}</span>
        </div>
      </div>
    </div>
  `
})
export class DatasheetEditorPage implements OnInit {
  private readonly notificationService = inject(NotificationService);
  @ViewChild(DatasheetGridComponent) grid!: DatasheetGridComponent;

  SaveIcon = Save;
  RefreshIcon = RefreshCw;
  DatabaseIcon = Database;
  FileSpreadsheetIcon = FileSpreadsheet;

  bookName = signal<string>('');
  readonly sidebarTab = signal<'properties' | 'import'>('properties');
  private readonly translate = inject(TranslateService);
  bookId: string | null = null;
  isSnapshot = false;

  formulaValue = '';
  showSuggestions = false;
  suggestions: any[] = [];
  allVariables: any[] = [];

  private route = inject(ActivatedRoute);

  private variablesService = inject(DatasheetVariablesService);

  /** Optional: also reachable through the router outlet, where there is no tab to rename. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

async ngOnInit(): Promise<void> {
    this.bookId = this.route.snapshot.paramMap.get('id');
    if (!this.bookId || this.bookId === 'new') {
       this.bookName.set(this.translate.instant('datasheets.untitled_book'));
    }
    if (this.bookId && this.bookId !== 'new') {
       const book = await firstValueFrom(this.variablesService.getBook(this.bookId));
       this.bookName.set(book.name);
       // The saved cells: a reopened book used to show an empty grid, as if nothing had been kept.
       this.grid?.load(book.sheets?.[0]?.cells);
       //  La hoja se llama por su nombre, no por el UUID con el que se abrió la pestaña.
       this.tab?.setTitle(book.name);
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
    try {
      const saved = await firstValueFrom(this.variablesService.saveBook({
         id: this.bookId && this.bookId !== 'new' ? this.bookId : undefined,
         name: this.bookName().trim() || this.translate.instant('datasheets.untitled_book'),
         mode: this.isSnapshot ? 'snapshot' : 'live',
         sheets: [{ name: 'Sheet1', cells: this.grid.getCells() }]
      }));
      // A new book keeps its id, so the next save updates it instead of creating another.
      if (saved?.id) this.bookId = saved.id;
      this.tab?.setTitle(this.bookName());
      this.notificationService.showSuccess('dialog.notify.workbook_saved');
    } catch {
      this.notificationService.showError('datasheets.save_failed');
    }
  }

  onImportRequested(formula: string) {
    this.grid.setCellFormula(formula);
    this.refreshGrid();
  }

  refreshGrid() {
    this.grid.refreshData();
  }
}
