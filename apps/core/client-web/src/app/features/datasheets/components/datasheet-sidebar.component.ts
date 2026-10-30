import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ChevronRight, CheckCircle2 } from 'lucide-angular';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { DatasheetImportService, ImportModule } from '../services/datasheet-import.service';
import { firstValueFrom } from 'rxjs';

export type DatasheetSidebarTab = 'properties' | 'import';
export type DatasheetCellType = 'general' | 'number' | 'currency' | 'date';

/**
 * The editor's side panel: the selected cells' format and the ERP import wizard.
 *
 * It was written in Tailwind utility classes the application does not load, so it rendered as
 * bare browser-default HTML beside the grid (QA R3-A06). It now carries its own styles on the
 * design tokens. The «Charts» tab only ever said «select a range», with nothing behind it, and is
 * gone until there is a chart to insert.
 */
@Component({
  selector: 'app-datasheet-sidebar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  template: `
    <div class="ds-side">
      <div class="ds-side__tabs" role="tablist">
        <button type="button" role="tab" [attr.aria-selected]="activeTab === 'properties'" [class.is-active]="activeTab === 'properties'" (click)="activeTab = 'properties'">
          {{ 'datasheets.properties' | translate }}
        </button>
        <button type="button" role="tab" [attr.aria-selected]="activeTab === 'import'" [class.is-active]="activeTab === 'import'" (click)="activeTab = 'import'">
          {{ 'datasheets.import' | translate }}
        </button>
      </div>

      <div class="ds-side__body">
        @if (activeTab === 'properties') {
          <h3 class="ds-side__heading">{{ 'datasheets.cell_format' | translate }}</h3>
          <label class="ds-side__label" for="datasheet-cell-type">{{ 'datasheets.cell_type' | translate }}</label>
          <select id="datasheet-cell-type" class="ds-side__select" (change)="cellTypeChange.emit($any($event.target).value)">
            <option value="general">{{ 'datasheets.cell_type.general' | translate }}</option>
            <option value="number">{{ 'datasheets.cell_type.number' | translate }}</option>
            <option value="currency">{{ 'datasheets.cell_type.currency' | translate }}</option>
            <option value="date">{{ 'datasheets.cell_type.date' | translate }}</option>
          </select>
          <p class="ds-side__hint">{{ 'datasheets.cell_type_hint' | translate }}</p>
        }

        @if (activeTab === 'import') {
          <h3 class="ds-side__heading">{{ 'datasheets.import_wizard' | translate }}</h3>

          @if (!selectedModule) {
            @for (mod of importModules; track mod.id) {
              <button type="button" class="ds-side__option" (click)="selectedModule = mod">
                <span>
                  <span class="ds-side__option-title">{{ mod.nameEn }}</span>
                  <span class="ds-side__option-sub">{{ 'datasheets.available_sets' | translate: { count: mod.sets.length } }}</span>
                </span>
                <lucide-icon [img]="ChevronRightIcon" [size]="16" aria-hidden="true"></lucide-icon>
              </button>
            } @empty {
              <p class="ds-side__hint">{{ 'datasheets.no_import_modules' | translate }}</p>
            }
          } @else if (!selectedSet) {
            <button type="button" class="ds-side__back" (click)="selectedModule = null">← {{ 'datasheets.back' | translate }}</button>
            @for (set of selectedModule.sets; track set) {
              <button type="button" class="ds-side__option" (click)="selectedSet = set">{{ set | titlecase }}</button>
            }
          } @else {
            <button type="button" class="ds-side__back" (click)="selectedSet = null">← {{ 'datasheets.back' | translate }}</button>
            <div class="ds-side__box">
              <p class="ds-side__label">{{ 'datasheets.columns_to_import' | translate }}</p>
              @for (col of importColumnKeys; track col) {
                <label class="ds-side__check"><input type="checkbox" checked disabled /> {{ col | translate }}</label>
              }
            </div>
            <button type="button" class="primary-button ds-side__confirm" (click)="confirmImport()">
              <lucide-icon [img]="CheckIcon" [size]="16" aria-hidden="true"></lucide-icon>
              {{ 'datasheets.confirm_import' | translate }}
            </button>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .ds-side { display: flex; flex-direction: column; height: 100%; background: var(--bg-primary); color: var(--text-primary); }
    .ds-side__tabs { display: flex; border-bottom: 1px solid var(--border-color); }
    .ds-side__tabs button {
      flex: 1; padding: var(--space-3) var(--space-2); background: none; border: 0; border-bottom: 2px solid transparent;
      font: inherit; font-size: var(--text-sm); font-weight: 500; color: var(--text-secondary); cursor: pointer;
    }
    .ds-side__tabs button:hover { color: var(--text-primary); }
    .ds-side__tabs button.is-active { color: var(--accent-text); border-bottom-color: var(--accent-primary); }
    .ds-side__body { flex: 1; overflow: auto; padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
    .ds-side__heading { margin: 0 0 var(--space-2); font-size: var(--text-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-secondary); }
    .ds-side__label { font-size: var(--text-xs); color: var(--text-secondary); }
    .ds-side__select { width: 100%; }
    .ds-side__hint { margin: 0; font-size: var(--text-xs); color: var(--text-secondary); }
    .ds-side__option {
      display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); width: 100%;
      padding: var(--space-3); text-align: left; font: inherit; font-size: var(--text-sm); color: inherit;
      background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); cursor: pointer;
    }
    .ds-side__option:hover { border-color: var(--accent-primary); }
    .ds-side__option-title { display: block; font-weight: 500; }
    .ds-side__option-sub { display: block; font-size: var(--text-xs); color: var(--text-secondary); }
    .ds-side__back { align-self: flex-start; padding: 0; background: none; border: 0; font: inherit; font-size: var(--text-xs); color: var(--accent-text); cursor: pointer; }
    .ds-side__box { padding: var(--space-3); background: var(--bg-secondary); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-1); }
    .ds-side__check { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); }
    .ds-side__confirm { justify-content: center; }
  `],
})
export class DatasheetSidebarComponent implements OnInit {
  @Input() activeTab: DatasheetSidebarTab = 'properties';
  importModules: ImportModule[] = [];

  /**
   * The columns the import wizard offers, as catalogue keys.
   *
   * They were written into the template as `['Nombre', 'Precio', 'Stock', 'Referencia']`, so the
   * wizard listed its columns in Spanish whatever language the reader had chosen.
   */
  readonly importColumnKeys = [
    'datasheets.import_column.name',
    'datasheets.import_column.price',
    'datasheets.import_column.stock',
    'datasheets.import_column.reference',
  ];
  selectedModule: ImportModule | null = null;
  selectedSet: string | null = null;

  @Output() importRequested = new EventEmitter<string>();
  /** The format chosen for the selected cells (it used to be a select wired to nothing). */
  @Output() cellTypeChange = new EventEmitter<DatasheetCellType>();

  readonly ChevronRightIcon = ChevronRight;
  readonly CheckIcon = CheckCircle2;

  private importService = inject(DatasheetImportService);

  async ngOnInit() {
    this.importModules = await firstValueFrom(this.importService.getModules());
  }

  confirmImport() {
    if (this.selectedModule && this.selectedSet) {
      const fnName = `IMPORTAR_${this.selectedModule.id.toUpperCase()}_${this.selectedSet.toUpperCase()}`;
      const formula = `=${fnName}("Nombre", "Precio", "Stock")`;
      this.importRequested.emit(formula);
      this.selectedModule = null;
      this.selectedSet = null;
    }
  }
}
