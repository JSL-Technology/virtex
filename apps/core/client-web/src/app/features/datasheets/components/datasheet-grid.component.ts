
import {
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewEncapsulation, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../../core/services/notification';
import { HotTableComponent } from '@handsontable/angular-wrapper';
import { registerAllModules } from 'handsontable/registry';
import Handsontable from 'handsontable';
import HyperFormula from 'hyperformula';
import { DatasheetVariablesService } from '../services/datasheet-variables.service';
import { firstValueFrom } from 'rxjs';

// Register Handsontable modules
registerAllModules();

@Component({
  selector: 'app-datasheet-grid',
  standalone: true,
  imports: [CommonModule, HotTableComponent],
  template: `<hot-table [settings]="hotSettings"></hot-table>`,
  // The grid fills its container. Handsontable 18 draws nothing without a theme and a sized host
  // (QA R3-A06: the editor opened onto a blank area).
  styles: [`app-datasheet-grid, app-datasheet-grid hot-table { display: block; width: 100%; height: 100%; }`],
  encapsulation: ViewEncapsulation.None
})
export class DatasheetGridComponent implements OnInit, OnDestroy {
  private readonly notificationService = inject(NotificationService);
  @Input() id = 'hot-editor';
  @ViewChild(HotTableComponent) private hotTable?: HotTableComponent;

  /**
   * The live grid. It was looked up with `window.Handsontable.getInstance(...)`, an API Handsontable
   * does not have, by an element id the grid never received — so saving, refreshing and the
   * ERP-formula guard all threw before doing anything.
   */
  get hot(): Handsontable | undefined {
    return this.hotTable?.hotInstance ?? undefined;
  }

  private hfInstance: any;
  private erpVariables: any[] = [];
  private resolvedValues: Record<string, any> = {};

  private variablesService = inject(DatasheetVariablesService);
@Input() data: any[][] = [
    ['', '', '', ''],
    ['', '', '', ''],
    ['', '', '', '']
  ];

  hotSettings: any = {
    data: this.data,
    colHeaders: true,
    rowHeaders: true,
    height: '100%',
    width: '100%',
    themeName: 'ht-theme-main',
    licenseKey: 'non-commercial-and-evaluation',
    formulas: {
      engine: HyperFormula,
      sheetName: 'Sheet1'
    },
    cells: (row: number, col: number) => {
       const cellProperties: any = {};
       cellProperties.renderer = this.customRenderer.bind(this);
       return cellProperties;
    },
    beforeBeginEditing: (row: number, col: number) => {
       const value = this.hot?.getSourceDataAtCell(row, col);
       if (typeof value === 'string' && value.startsWith('=')) {
          // Check if it's an ERP variable
          if (this.isERPVariableFormula(value)) {
             this.notificationService.showWarning('dialog.notify.value_comes_from_erp_cannot_edited');
             return false;
          }
       }
       return true;
    },
    contextMenu: true,
    manualColumnResize: true,
    manualRowResize: true,
    autoWrapRow: true,
    autoWrapCol: true,
    stretchH: 'all'
  };

  private customRenderer(instance: any, td: HTMLElement, row: number, col: number, prop: string | number, value: any, cellProperties: any) {
    Handsontable.renderers.TextRenderer.apply(this, [instance, td, row, col, prop, value, cellProperties]);

    const sourceValue = instance.getSourceDataAtCell(row, col);
    if (typeof sourceValue === 'string' && this.isERPVariableFormula(sourceValue)) {
      td.style.color = 'var(--accent-text)';
      td.style.fontWeight = '500';
    }

    if (String(value).startsWith('#')) {
      td.style.color = 'var(--error-text)';
    }
  }

  private isERPVariableFormula(formula: string): boolean {
    if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) return false;
    const upperFormula = formula.toUpperCase();
    return this.erpVariables.some(v =>
      upperFormula.includes(v.nameEn.toUpperCase()) ||
      upperFormula.includes(v.nameEs.toUpperCase())
    );
  }

  async ngOnInit(): Promise<void> {
    await this.registerERPFuntions();
  }

  /** Replace the grid's contents — a saved book being reopened. */
  load(cells: unknown[][] | null | undefined): void {
    if (!cells?.length) return;
    this.hot?.loadData(cells as Handsontable.CellValue[][]);
  }

  /** The grid's contents, formulas included, for saving. */
  getCells(): unknown[][] {
    return (this.hot?.getSourceData() as unknown[][]) ?? [];
  }

  /** Format the selected cells: general text, number, currency or date. */
  setCellType(type: 'general' | 'number' | 'currency' | 'date'): void {
    const hot = this.hot;
    const selected = hot?.getSelected();
    if (!hot || !selected?.length) return;
    for (const [r1, c1, r2, c2] of selected) {
      for (let row = Math.min(r1, r2); row <= Math.max(r1, r2); row++) {
        for (let col = Math.min(c1, c2); col <= Math.max(c1, c2); col++) {
          if (type === 'general') hot.setCellMetaObject(row, col, { type: 'text', numericFormat: undefined });
          if (type === 'number') hot.setCellMetaObject(row, col, { type: 'numeric', numericFormat: { pattern: '0,0.00' } });
          if (type === 'currency') hot.setCellMetaObject(row, col, { type: 'numeric', numericFormat: { pattern: '$0,0.00' } });
          if (type === 'date') hot.setCellMetaObject(row, col, { type: 'date', dateFormat: 'YYYY-MM-DD', correctFormat: true });
        }
      }
    }
    hot.render();
  }

  setCellFormula(formula: string) {
     const hot = this.hot;
     if (!hot) return;
     const selected = hot.getSelected() || [[0, 0]];
     const [row, col] = selected[0];
     hot.setDataAtCell(row, col, formula);
  }

  private async registerERPFuntions() {
    const variables = await firstValueFrom(this.variablesService.getVariables());
    this.erpVariables = variables;

    variables.forEach(v => {
      const names = [v.nameEn.toUpperCase(), v.nameEs.toUpperCase()];

      names.forEach(name => {
        try {
          (HyperFormula as any).registerFunction(name, {
            method: (ast: any, formulaAddress: any, hyperFormula: any, ...args: any[]) => {
              const key = `${name}${args.length ? '(' + args.map(a => '"' + a + '"').join(',') + ')' : ''}`;
              return this.resolvedValues[key] ?? '#CARGANDO...';
            },
            isFunctionAsync: false,
            parameters: (v.params || []).map(() => ({ argumentType: 'ANY' }))
          });
        } catch (error) {
          // HyperFormula refuses a duplicate registration; that is expected when the grid is
          // rebuilt, and silently swallowing every other failure hid genuinely broken formulas.
          console.warn(`Could not register spreadsheet function ${v.nameEn}:`, error);
        }
      });
    });

    // Register IMPORTAR functions
    ['IMPORTAR_PRODUCTOS', 'IMPORTAR_CLIENTES', 'IMPORTAR_VENTAS'].forEach(fnName => {
       try {
          (HyperFormula as any).registerFunction(fnName, {
            method: (ast: any, formulaAddress: any, hyperFormula: any, ...args: any[]) => {
              const key = `${fnName}(${args.map(a => '"' + a + '"').join(',')})`;
              const data = this.resolvedValues[key];
              if (data && Array.isArray(data)) {
                return data;
              }
              return '#CARGANDO_DATOS...';
            },
            isFunctionAsync: false,
            parameters: [{ argumentType: 'ANY', amount: { min: 1, max: 20 } }]
          });
       } catch (error) {
          console.warn(`Could not register spreadsheet function ${fnName}:`, error);
       }
    });
  }

  async refreshData() {
    const hot = this.hot;
    if (!hot) return;
    const formulas = hot.getData().flat().filter((v: any) => typeof v === 'string' && v.startsWith('='));

    const varsToResolve: any[] = [];
    formulas.forEach((f: string) => {
      const match = f.match(/=([A-Z_0-9]+)(?:\((.*)\))?/i);
      if (match) {
        const name = match[1];
        const params = match[2] ? match[2].split(',').map(p => p.trim().replace(/['"]/g, '')) : [];
        varsToResolve.push({ name, params });
      }
    });

    if (varsToResolve.length > 0) {
      this.resolvedValues = await firstValueFrom(this.variablesService.resolveVariables(varsToResolve));
      hot.render(); // Force re-render to show new values
    }
  }

  ngOnDestroy(): void {
    // The Handsontable instance owns DOM nodes and listeners that outlive the component unless it
    // is destroyed explicitly; the method was previously an empty body with a `// Cleanup logic`
    // comment, so every visit to a datasheet leaked one.
    const instance = this.hot;
    if (instance && !instance.isDestroyed) instance.destroy();
  }
}
